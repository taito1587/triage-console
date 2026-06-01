"""S2: トリアージ品質の評価 (正答率 / groundedness)。

ラベル付きテストセット(data/eval_set.json)に対してトリアージを実行し、
Top1/Top3 正答率と groundedness(根拠提示率) を計測する。
現場知見(フィードバック)の ON/OFF で比較でき、"使うほど賢くなる"を定量化する。
新規ファイルのみ（共有ファイルは編集しない）。triage_core を再利用。
"""
import json
from pathlib import Path

import triage_core as core

ROOT = Path(__file__).parent
EVAL_SET = ROOT / "data" / "eval_set.json"


def load_set():
    with open(EVAL_SET, encoding="utf-8") as f:
        return json.load(f)


def _hit(causes, expected):
    """root_causes のリストから、各順位が expected キーワードのいずれかを含むか。"""
    flags = []
    for c in causes:
        text = (c.get("cause", "") + " " + c.get("evidence", "")).lower()
        flags.append(any(k.lower() in text for k in expected))
    return flags


def run_eval(use_feedback=True):
    client = core.get_client()
    if client is None:
        raise RuntimeError("AOAI未設定")
    corpus = core.load_corpus()
    feedback = core.load_feedback() if use_feedback else []
    cases = load_set()
    details = []
    top1 = top3 = grounded = 0
    equip = {e["equipment_id"]: e for e in corpus["equipment_specs"]}
    for cs in cases:
        eqid = cs["equipment_id"]
        intake = {"equipment_id": eqid, "equipment_name": equip.get(eqid, {}).get("equipment_name", eqid),
                  "process": equip.get(eqid, {}).get("process", ""), "error_code": cs.get("error_code", ""),
                  "symptom": cs.get("symptom", "その他"), "free_text": cs.get("free_text", "")}
        results = core.retrieve(corpus, feedback, eqid, intake["error_code"],
                                intake["free_text"], intake["symptom"])
        tri = core.run_triage(client, intake, results, None)
        causes = tri.get("root_causes", [])
        flags = _hit(causes, cs["expected_causes"])
        is_top1 = bool(flags and flags[0])
        is_top3 = any(flags[:3])
        is_grounded = len(tri.get("citations", [])) > 0
        top1 += is_top1; top3 += is_top3; grounded += is_grounded
        details.append({
            "id": cs["id"], "equipment_id": eqid, "expected": cs["expected_causes"],
            "predicted_top": (causes[0].get("cause", "") if causes else ""),
            "top1": is_top1, "top3": is_top3, "grounded": is_grounded,
        })
    n = len(cases)
    return {
        "n": n, "use_feedback": use_feedback,
        "top1_accuracy": round(100 * top1 / n) if n else 0,
        "top3_accuracy": round(100 * top3 / n) if n else 0,
        "grounded_rate": round(100 * grounded / n) if n else 0,
        "details": details,
    }
