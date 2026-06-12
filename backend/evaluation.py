"""S2: トリアージ品質の評価 (正答率 / groundedness)。

ラベル付きテストセット(data/eval_set.json)に対してトリアージを実行し、
Top1/Top3 正答率と groundedness(根拠提示率) を計測する。
現場知見(フィードバック)の ON/OFF で比較でき、"使うほど賢くなる"を定量化する。
"""
import os
import json
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

from openai import AzureOpenAI

from . import triage_core as core

ROOT = Path(__file__).parent.parent
EVAL_SET = ROOT / "data" / "eval_set.json"
EVAL_WORKERS = int(os.getenv("EVAL_WORKERS", "4"))


def _bounded_client():
    return AzureOpenAI(azure_endpoint=core.AOAI_ENDPOINT, api_key=core.AOAI_KEY,
                       api_version=core.AOAI_API_VERSION, timeout=40.0, max_retries=1)


def load_set():
    with open(EVAL_SET, encoding="utf-8") as f:
        return json.load(f)


def _hit(causes, expected):
    """各順位の「原因(cause)」が expected キーワードのいずれかに一致するか。
    根拠文(evidence)は判定に使わない(根拠でかすめただけの“水増し正解”を防ぐ)。
    予測原因と期待語の双方向部分一致で、表記の粒度差(より具体/一般)を許容する。"""
    exp = [k.lower() for k in expected if k]
    flags = []
    for c in causes:
        cause = (c.get("cause", "") if isinstance(c, dict) else str(c)).lower()
        flags.append(bool(cause) and any(k in cause or cause in k for k in exp))
    return flags


def _query_of(intake):
    return (f"設備:{intake['equipment_id']} エラーコード:{intake.get('error_code','')} "
            f"症状:{intake.get('symptom','')} {intake.get('free_text','')}").strip()


def run_eval(use_feedback=True):
    if core.get_client() is None:
        raise RuntimeError("AOAI未設定")
    client = _bounded_client()
    corpus = core.load_corpus()
    feedback = core.load_feedback() if use_feedback else []
    cases = load_set()
    equip = {e["equipment_id"]: e for e in corpus["equipment_specs"]}
    intakes = [{"equipment_id": cs["equipment_id"],
                "equipment_name": equip.get(cs["equipment_id"], {}).get("equipment_name", cs["equipment_id"]),
                "process": equip.get(cs["equipment_id"], {}).get("process", ""),
                "error_code": cs.get("error_code", ""), "symptom": cs.get("symptom", "その他"),
                "free_text": cs.get("free_text", "")} for cs in cases]
    # 並列前に埋め込みを単一スレッドでウォーム(キャッシュ競合回避)
    try:
        pools = core._pools(corpus, feedback)
        corpus_texts = [(d.get("text") or " ") for docs in pools.values() for d in docs]
        core.embed_texts(corpus_texts + [_query_of(i) for i in intakes])
    except Exception:  # noqa
        pass

    def _eval_one(pair):
        cs, intake = pair
        try:
            results = core.retrieve(corpus, feedback, intake["equipment_id"], intake["error_code"],
                                    intake["free_text"], intake["symptom"])
            tri = core.run_triage(client, intake, results, None)
            causes = tri.get("root_causes", [])
            flags = _hit(causes, cs["expected_causes"])
            return {
                "id": cs["id"], "equipment_id": cs["equipment_id"], "expected": cs["expected_causes"],
                "predicted_top": (causes[0].get("cause", "") if causes else ""),
                "top1": bool(flags and flags[0]), "top3": any(flags[:3]),
                "grounded": len(tri.get("citations", [])) > 0,
            }
        except Exception as e:  # noqa  1件失敗は0点扱いで継続
            return {"id": cs["id"], "equipment_id": cs["equipment_id"], "expected": cs["expected_causes"],
                    "predicted_top": f"(評価失敗: {str(e)[:40]})", "top1": False, "top3": False, "grounded": False}

    with ThreadPoolExecutor(max_workers=EVAL_WORKERS) as ex:
        details = list(ex.map(_eval_one, zip(cases, intakes)))
    top1 = sum(d["top1"] for d in details)
    top3 = sum(d["top3"] for d in details)
    grounded = sum(d["grounded"] for d in details)
    n = len(cases)
    return {
        "n": n, "use_feedback": use_feedback,
        "top1_accuracy": round(100 * top1 / n) if n else 0,
        "top3_accuracy": round(100 * top3 / n) if n else 0,
        "grounded_rate": round(100 * grounded / n) if n else 0,
        "details": details,
    }
