"""自律インシデント・トリアージ (R1 + S1 クローズドループ + S3 人間承認)。

設備アラーム/イベントのストリームを取り込み、エージェントが各件を自動トリアージして
インシデント・ボードに積む。High は人間承認待ちにし、承認で初めて保全へ通知(実行)。
復旧フィードバックでクローズし、学習(現場確定事例)へ還流する。

triage_core の検索・トリアージ・通知・フィードバック保存を再利用する。Cosmos の `incidents` コンテナを使用。
"""
import os
import json
import datetime
import threading
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

from openai import AzureOpenAI

from . import triage_core as core

INGEST_WORKERS = int(os.getenv("INGEST_WORKERS", "8"))


class InvalidState(Exception):
    """不正な状態遷移(承認/解決の前提ステータス違反)。ルートで 409 にマップする。"""


def _bounded_client():
    """タイムアウト/リトライ上限つきの AOAI クライアント(1件のstallで全体が固まるのを防ぐ)。"""
    return AzureOpenAI(azure_endpoint=core.AOAI_ENDPOINT, api_key=core.AOAI_KEY,
                       api_version=core.AOAI_API_VERSION, timeout=40.0, max_retries=1)


def _query_of(intake):
    """retrieve と同じクエリ文字列(埋め込み事前ウォーム用)。"""
    return (f"設備:{intake['equipment_id']} エラーコード:{intake.get('error_code','')} "
            f"症状:{intake.get('symptom','')} {intake.get('free_text','')}").strip()


def _warm_embeddings(corpus, feedback, intakes):
    """並列トリアージ前に埋め込みを単一スレッドで事前計算しキャッシュ競合を避ける。"""
    try:
        pools = core._pools(corpus, feedback)
        corpus_texts = [(d.get("text") or " ") for docs in pools.values() for d in docs]
        core.embed_texts(corpus_texts + [_query_of(i) for i in intakes])
    except Exception:  # noqa  retrieve 側がフォールバックするので致命でない
        pass

ROOT = Path(__file__).parent.parent
SAMPLE_EVENTS = ROOT / "data" / "sample_events.json"

_inc_container = None


def _now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")


def _container():
    """インシデント用 Cosmos コンテナ(未設定ならローカルJSONにフォールバック)。"""
    global _inc_container
    if not (core.COSMOS_ENDPOINT and core.COSMOS_KEY):
        return None
    if _inc_container is None:
        from azure.cosmos import CosmosClient, PartitionKey
        client = CosmosClient(core.COSMOS_ENDPOINT, credential=core.COSMOS_KEY)
        try:
            db = client.create_database_if_not_exists(core.COSMOS_DB)
        except Exception:  # noqa
            db = client.get_database_client(core.COSMOS_DB)
        try:
            _inc_container = db.create_container_if_not_exists(
                id="incidents", partition_key=PartitionKey(path="/equipment_id"))
        except Exception:  # noqa
            _inc_container = db.get_container_client("incidents")
    return _inc_container


# --- ローカルフォールバック(Cosmos未設定時) ---------------------------------
_LOCAL = ROOT / "data" / "incidents.json"
_LOCK = threading.Lock()  # ローカルJSONの read-modify-write を直列化(更新ロスト/破損防止)


def _local_load():
    if _LOCAL.exists():
        try:
            with open(_LOCAL, encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):  # 破損/競合時は空で継続
            return []
    return []


def _local_save(items):
    # 原子的書き込み: 一時ファイルへ書いて rename(部分書き込み/破損を防ぐ)
    tmp = _LOCAL.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)
    os.replace(tmp, _LOCAL)


def _upsert(inc):
    c = _container()
    if c is not None:
        c.upsert_item(inc)
        return
    with _LOCK:
        items = [x for x in _local_load() if x.get("id") != inc["id"]]
        items.append(inc)
        _local_save(items)


def _all():
    c = _container()
    if c is not None:
        return list(c.read_all_items())
    return _local_load()


def _get(incident_id):
    # 小規模のため全件から検索(Cosmosは read_all_items、PK不要)。件数増時は
    # equipment_id を引数に取り read_item(id, partition_key) 化するのが本筋。
    for x in _all():
        if x.get("id") == incident_id:
            return x
    return None


# --- R1: 取り込み + 自動トリアージ(アクションは実行しない=承認待ち) -----------
TRIAGE_FIELDS = ["urgency", "root_causes", "first_checks", "recommended_actions",
                 "escalation", "image_findings", "citations"]


def _event_id(ev):
    """イベント→インシデントID(冪等化のため取り込み前から決定できる安定ID)。"""
    return ev.get("id") or f"inc-{ev.get('equipment_id', '')}-{ev.get('ts', '')}"


def _build_intake(ev, equip):
    eqid = ev.get("equipment_id", "")
    spec = equip.get(eqid, {})
    return {
        "equipment_id": eqid,
        "equipment_name": spec.get("equipment_name", eqid),
        "process": spec.get("process", ""),
        "error_code": ev.get("error_code", ""),
        "symptom": ev.get("symptom", "その他"),
        "free_text": ev.get("free_text", ""),
    }


def ingest(events):
    """イベント列を自動トリアージしてインシデント化(High は承認待ち)。
    冪等: 既存IDのイベントはスキップ(承認/解決など人手で設定した状態を壊さない)。
    埋め込みを事前ウォームしてから run_triage を並列実行する(キャッシュ競合を回避)。"""
    if core.get_client() is None:
        raise RuntimeError("AOAI未設定")
    # 既に存在するインシデント(=人手で状態を持つ可能性)は再取り込みしない
    existing = {x.get("id") for x in _all()}
    events = [ev for ev in events if _event_id(ev) not in existing]
    if not events:
        return []
    client = _bounded_client()
    corpus = core.load_corpus()
    feedback = core.load_feedback()
    equip = {e["equipment_id"]: e for e in corpus["equipment_specs"]}
    intakes = [_build_intake(ev, equip) for ev in events]
    _warm_embeddings(corpus, feedback, intakes)

    def _triage(pair):
        ev, intake = pair
        # トリアージのみ(自動アクションはしない=S3の承認を待つ)
        try:
            results = core.retrieve(corpus, feedback, intake["equipment_id"], intake["error_code"],
                                    intake["free_text"], intake["symptom"])
            tri = core.run_triage(client, intake, results, None)
        except Exception as e:  # noqa  1件失敗でもボードは埋める(縮退)
            tri = {"urgency": {"level": "Medium", "reason": f"自動診断に失敗(要手動確認): {str(e)[:80]}"},
                   "root_causes": [], "first_checks": [], "similar_cases": [],
                   "recommended_actions": [], "escalation": {"should_notify": False},
                   "image_findings": None, "citations": []}
        return ev, intake, tri

    with ThreadPoolExecutor(max_workers=INGEST_WORKERS) as ex:
        triaged = list(ex.map(_triage, zip(events, intakes)))

    created = []
    for ev, intake, tri in triaged:
        urg = tri.get("urgency", {}).get("level", "Medium")
        rc = (tri.get("root_causes") or [{}])[0]
        needs_approval = urg == "High" and tri.get("escalation", {}).get("should_notify")
        inc = {
            "id": _event_id(ev),
            "equipment_id": intake["equipment_id"],
            "equipment_name": intake["equipment_name"],
            "error_code": intake["error_code"],
            "symptom": intake["symptom"],
            "free_text": intake["free_text"],
            "source": ev.get("source", "アラーム"),
            "created_at": ev.get("ts") or _now(),
            "urgency": urg,
            "top_cause": rc.get("cause", ""),
            "confidence": rc.get("confidence", 0),
            "status": "awaiting_approval" if needs_approval else "triaged",
            "triage": {k: tri.get(k) for k in TRIAGE_FIELDS},
            "audit": [{"action": "auto_triaged", "by": "AIエージェント", "ts": _now(),
                       "detail": f"緊急度{urg} / 第一候補 {rc.get('cause','-')}"}],
            "resolution": None,
        }
        _upsert(inc)
        created.append(inc)
    return created


def ingest_sample():
    with open(SAMPLE_EVENTS, encoding="utf-8") as f:
        return ingest(json.load(f))


# --- ボード取得 -------------------------------------------------------------
_ORDER = {"awaiting_approval": 0, "triaged": 1, "escalated": 2, "resolved": 3}
_URG = {"High": 0, "Medium": 1, "Low": 2}


def board(status=None):
    items = _all()
    if status:
        items = [x for x in items if x.get("status") == status]
    items.sort(key=lambda x: (_ORDER.get(x.get("status"), 9),
                              _URG.get(x.get("urgency"), 9),
                              x.get("created_at", "")))
    return items


# --- S3: 人間承認 → 保全へ実行(通知) ----------------------------------------
def approve(incident_id, approver="現場責任者"):
    inc = _get(incident_id)
    if not inc:
        raise KeyError(incident_id)
    if inc.get("status") != "awaiting_approval":
        raise InvalidState(f"承認できる状態ではありません（現在: {inc.get('status')}）")
    esc = (inc.get("triage") or {}).get("escalation", {}) or {}
    sent, text = core.notify_teams(esc.get("message", ""),
                                   {"equipment_name": inc["equipment_name"], "symptom": inc["symptom"]},
                                   inc.get("urgency", "High"))
    inc["status"] = "escalated"
    inc["audit"].append({"action": "approved_escalated", "by": approver, "ts": _now(),
                         "detail": ("保全へTeams通知を送信" if sent else "(デモ)保全へ通知をシミュレート")})
    _upsert(inc)
    return inc


# --- S1: 復旧フィードバックでクローズ → 学習へ還流 --------------------------
def resolve(incident_id, root_cause, recovery_minutes, note="", ai_was_correct="当たり", by="現場担当"):
    inc = _get(incident_id)
    if not inc:
        raise KeyError(incident_id)
    if inc.get("status") == "resolved":
        raise InvalidState("このインシデントは既に解決済みです")
    inc["status"] = "resolved"
    inc["resolution"] = {"root_cause": root_cause, "recovery_minutes": recovery_minutes,
                         "note": note, "ai_was_correct": ai_was_correct, "resolved_at": _now()}
    inc["audit"].append({"action": "resolved", "by": by, "ts": _now(),
                         "detail": f"原因={root_cause} / 復旧{recovery_minutes}分 / AI={ai_was_correct}"})
    _upsert(inc)
    # 学習ループ: 確定事例としてフィードバックに保存(次回トリアージで参照)
    today = _now()[:10]
    core.save_feedback({
        "doc_id": f"fb-{inc['id']}", "equipment_id": inc["equipment_id"], "date": today,
        "symptom": inc["symptom"], "error_code": inc["error_code"],
        "root_cause": root_cause, "action_taken": note or "対応実施", "recovery_minutes": recovery_minutes,
        "ai_was_correct": ai_was_correct, "responder_note": note,
        "text": (f"{today} {inc['equipment_id']} {inc['symptom']} {inc['error_code']}。"
                 f"原因={root_cause}。復旧{recovery_minutes}分。{note}"),
    })
    return inc


# --- KPI(ボードのヘッダ集計) -------------------------------------------------
def kpi():
    items = _all()
    by_status = {}
    for x in items:
        by_status[x.get("status", "?")] = by_status.get(x.get("status", "?"), 0) + 1
    resolved = [x for x in items if x.get("status") == "resolved" and x.get("resolution")]
    # 0分復旧も有効値として平均に含める(None のみ除外)
    recs = [r["resolution"]["recovery_minutes"] for r in resolved
            if r["resolution"].get("recovery_minutes") is not None]
    # 的中率: 「当たり」=1.0 / 「部分的」=0.5 で加重(部分的を満点扱いしない)
    hit = sum(1.0 if r["resolution"].get("ai_was_correct") == "当たり"
              else 0.5 if r["resolution"].get("ai_was_correct") == "部分的" else 0.0
              for r in resolved)
    return {
        "total": len(items),
        "awaiting_approval": by_status.get("awaiting_approval", 0),
        "triaged": by_status.get("triaged", 0),
        "escalated": by_status.get("escalated", 0),
        "resolved": by_status.get("resolved", 0),
        "avg_recovery": round(sum(recs) / len(recs), 1) if recs else 0,
        "ai_hit_rate": round(100 * hit / len(resolved)) if resolved else None,
    }


def clear_all():
    """デモ用: 全インシデント削除。"""
    c = _container()
    if c is not None:
        for x in list(c.read_all_items()):
            try:
                c.delete_item(x["id"], partition_key=x.get("equipment_id"))
            except Exception:  # noqa
                pass
    elif _LOCAL.exists():
        _LOCAL.unlink()
