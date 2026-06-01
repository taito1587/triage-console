"""Manufacturing Triage Agent — コアロジック (UIフレームワーク非依存)。
Streamlit版(app.py)とFastAPI版(server.py)で共有する。"""
import os
import json
import base64
from pathlib import Path

from openai import AzureOpenAI

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:  # noqa
    pass

ROOT = Path(__file__).parent
CORPUS_PATH = ROOT / "data" / "corpus.json"
FEEDBACK_PATH = ROOT / "data" / "feedback.json"

AOAI_ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT", "")
AOAI_KEY = os.getenv("AZURE_OPENAI_API_KEY", "")
AOAI_DEPLOYMENT = os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4o")
AOAI_API_VERSION = os.getenv("AZURE_OPENAI_API_VERSION", "2024-10-21")
TEAMS_WEBHOOK_URL = os.getenv("TEAMS_WEBHOOK_URL", "")

SYMPTOM_CATEGORIES = ["異音", "停止", "温度異常", "品質不良", "振動", "その他"]


def load_corpus():
    with open(CORPUS_PATH, encoding="utf-8") as f:
        return json.load(f)


def load_feedback():
    if FEEDBACK_PATH.exists():
        with open(FEEDBACK_PATH, encoding="utf-8") as f:
            return json.load(f)
    return []


def save_feedback(item):
    fb = load_feedback()
    fb.append(item)
    FEEDBACK_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(FEEDBACK_PATH, "w", encoding="utf-8") as f:
        json.dump(fb, f, ensure_ascii=False, indent=2)
    return item


def get_client():
    if not (AOAI_ENDPOINT and AOAI_KEY):
        return None
    return AzureOpenAI(
        azure_endpoint=AOAI_ENDPOINT, api_key=AOAI_KEY, api_version=AOAI_API_VERSION,
    )


def retrieve(corpus, feedback, equipment_id, error_code, free_text, symptom, top_k=5):
    """超軽量ハイブリッド: 設備ID/エラーコード一致 + キーワード重なりでスコアリング。"""
    query = f"{equipment_id} {error_code} {symptom} {free_text}".lower()
    q_terms = set(t for t in query.replace("　", " ").split() if t)
    fb_troubles = [{**fb, "source": "feedback", "text": fb.get("text", "")} for fb in feedback]
    pools = {
        "past_trouble": corpus["past_troubles"] + fb_troubles,
        "procedure": corpus["procedures"],
        "equipment_spec": corpus["equipment_specs"],
        "quality_record": corpus["quality_records"],
    }

    def score(doc):
        s = 0
        if equipment_id and doc.get("equipment_id") == equipment_id:
            s += 5
        if error_code and error_code.lower() in json.dumps(doc, ensure_ascii=False).lower():
            s += 4
        text = doc.get("text", "").lower()
        s += sum(1 for t in q_terms if t and t in text)
        if doc.get("source") == "feedback":
            s += 2
        return s

    results = {}
    for kind, docs in pools.items():
        ranked = sorted(docs, key=score, reverse=True)
        results[kind] = [d for d in ranked if score(d) > 0][:top_k]
    return results


LABEL = {"past_trouble": "過去トラブル", "procedure": "作業手順書",
         "equipment_spec": "設備仕様", "quality_record": "品質記録"}


def build_context(results):
    lines = []
    for kind, docs in results.items():
        for d in docs:
            tag = "【現場確定】" if d.get("source") == "feedback" else ""
            lines.append(f"[{LABEL[kind]}{tag}] id={d.get('doc_id','-')}: {d.get('text','')}")
    return "\n".join(lines)


TRIAGE_SCHEMA_HINT = """
必ず次のJSONスキーマで返答してください(日本語):
{
  "urgency": {"level": "High|Medium|Low", "reason": "判断理由"},
  "root_causes": [{"rank":1,"cause":"...","evidence":"参照根拠","confidence":0.0}],
  "first_checks": [{"order":1,"action":"..."}],
  "similar_cases": [{"title":"...","date":"YYYY-MM-DD","cause":"...","recovery_minutes":0,"note":"..."}],
  "recommended_actions": ["..."],
  "escalation": {"should_notify": true, "to": "保全/品質保証/リーダー", "message": "通知文(1-2行)"},
  "image_findings": "画像所見(なければnull)"
}
root_causesは最大3件・確信度の高い順。first_checksは現場が最初にやる順。
similar_casesは渡された過去トラブル/フィードバックから関連するものを抽出。"""

SYSTEM_PROMPT = """あなたは製造現場のトリアージ支援エージェントです。
渡された「設備仕様・作業手順書・過去トラブル・品質記録・現場フィードバック」だけを根拠に判断し、
推測で断定しないこと。根拠は必ず渡された資料に紐づけること。
緊急度はライン停止/品質影響/安全リスクの観点で判断する。
出力は指定JSONのみ(前後に余計な文章を付けない)。"""


def run_triage(client, intake, results, image_b64=None):
    context = build_context(results)
    user_text = f"""# 現場入力
設備: {intake['equipment_name']} ({intake['equipment_id']})
工程: {intake['process']}
エラーコード: {intake['error_code']}
症状カテゴリ: {intake['symptom']}
自由記述: {intake['free_text']}

# 参照資料(これだけを根拠にする)
{context}

{TRIAGE_SCHEMA_HINT}
"""
    content = [{"type": "text", "text": user_text}]
    if image_b64:
        content.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}})
        content[0]["text"] += "\n# 添付画像\n画像を解析し、摩耗痕/異物/エラー表示などの所見を image_findings に記載し判断に反映すること。"

    resp = client.chat.completions.create(
        model=AOAI_DEPLOYMENT,
        messages=[{"role": "system", "content": SYSTEM_PROMPT},
                  {"role": "user", "content": content}],
        response_format={"type": "json_object"},
        temperature=0.2, max_tokens=1500,
    )
    out = json.loads(resp.choices[0].message.content)
    # 根拠(citations)を付加
    out["citations"] = [
        {"source_type": kind, "label": LABEL[kind], "doc_id": d.get("doc_id", "-"),
         "text": d.get("text", ""), "is_feedback": d.get("source") == "feedback"}
        for kind, docs in results.items() for d in docs
    ]
    return out


def notify_teams(message, intake, urgency):
    text = (f"🚨 製造トリアージ通知 [{urgency}]\n"
            f"設備: {intake['equipment_name']} / 症状: {intake['symptom']}\n{message}")
    if not TEAMS_WEBHOOK_URL:
        return False, text
    import urllib.request
    payload = json.dumps({"text": text}).encode()
    req = urllib.request.Request(TEAMS_WEBHOOK_URL, data=payload,
                                 headers={"Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=10)
        return True, text
    except Exception as e:  # noqa
        return False, f"{text}\n(送信失敗: {e})"
