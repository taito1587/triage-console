"""自律インシデント・トリアージ (R1 + S1 クローズドループ + S3 人間承認)。

設備アラーム/イベントのストリームを取り込み、エージェントが各件を自動トリアージして
インシデント・ボードに積む。High は人間承認待ちにし、承認で初めて保全へ通知(実行)。
復旧フィードバックでクローズし、学習(現場確定事例)へ還流する。

triage_core の検索・トリアージ・通知・フィードバック保存を再利用する。
新規ファイルのみ（共有ファイルは編集しない）。Cosmos の `incidents` コンテナを使用。
"""
import os
import json
import datetime
from pathlib import Path

import triage_core as core

ROOT = Path(__file__).parent
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


def _local_load():
    if _LOCAL.exists():
        with open(_LOCAL, encoding="utf-8") as f:
            return json.load(f)
    return []


def _local_save(items):
    with open(_LOCAL, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)


def _upsert(inc):
    c = _container()
    if c is not None:
        c.upsert_item(inc)
        return
    items = [x for x in _local_load() if x.get("id") != inc["id"]]
    items.append(inc)
    _local_save(items)


def _all():
    c = _container()
    if c is not None:
        return list(c.read_all_items())
    return _local_load()


def _get(incident_id):
    for x in _all():
        if x.get("id") == incident_id:
            return x
    return None


# --- R1: 取り込み + 自動トリアージ(アクションは実行しない=承認待ち) -----------
TRIAGE_FIELDS = ["urgency", "root_causes", "first_checks", "recommended_actions",
                 "escalation", "image_findings", "citations"]


def ingest(events):
    """イベント列を自動トリアージしてインシデント化(High は承認待ち)。"""
    client = core.get_client()
    if client is None:
        raise RuntimeError("AOAI未設定")
    corpus = core.load_corpus()
    feedback = core.load_feedback()
    equip = {e["equipment_id"]: e for e in corpus["equipment_specs"]}
    created = []
    for ev in events:
        eqid = ev.get("equipment_id", "")
        spec = equip.get(eqid, {})
        intake = {
            "equipment_id": eqid,
            "equipment_name": spec.get("equipment_name", eqid),
            "process": spec.get("process", ""),
            "error_code": ev.get("error_code", ""),
            "symptom": ev.get("symptom", "その他"),
            "free_text": ev.get("free_text", ""),
        }
        # トリアージのみ(自動アクションはしない=S3の承認を待つ)
        results = core.retrieve(corpus, feedback, eqid, intake["error_code"],
                                intake["free_text"], intake["symptom"])
        tri = core.run_triage(client, intake, results, None)
        urg = tri.get("urgency", {}).get("level", "Medium")
        rc = (tri.get("root_causes") or [{}])[0]
        needs_approval = urg == "High" and tri.get("escalation", {}).get("should_notify")
        inc = {
            "id": ev.get("id") or f"inc-{eqid}-{ev.get('ts','')}",
            "equipment_id": eqid,
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
    recs = [r["resolution"]["recovery_minutes"] for r in resolved if r["resolution"].get("recovery_minutes")]
    correct = [r for r in resolved if r["resolution"].get("ai_was_correct") in ("当たり", "部分的")]
    return {
        "total": len(items),
        "awaiting_approval": by_status.get("awaiting_approval", 0),
        "triaged": by_status.get("triaged", 0),
        "escalated": by_status.get("escalated", 0),
        "resolved": by_status.get("resolved", 0),
        "avg_recovery": round(sum(recs) / len(recs), 1) if recs else 0,
        "ai_hit_rate": round(100 * len(correct) / len(resolved)) if resolved else None,
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
