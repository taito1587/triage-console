"""Manufacturing Triage Agent — コアロジック (UIフレームワーク非依存)。
Streamlit版(app.py)とFastAPI版(server.py)で共有する。"""
import os
import json
import base64
import math
import hashlib
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


# --- フィードバック永続化: COSMOS_* があれば Cosmos DB、無ければローカルJSON -----
COSMOS_ENDPOINT = os.getenv("COSMOS_ENDPOINT", "")
COSMOS_KEY = os.getenv("COSMOS_KEY", "")
COSMOS_DB = os.getenv("COSMOS_DB", "mta")
COSMOS_CONTAINER = os.getenv("COSMOS_CONTAINER", "feedback")
_cosmos_container = None


def _cosmos():
    """Cosmos コンテナを返す(未設定なら None)。"""
    global _cosmos_container
    if not (COSMOS_ENDPOINT and COSMOS_KEY):
        return None
    if _cosmos_container is None:
        from azure.cosmos import CosmosClient, PartitionKey
        client = CosmosClient(COSMOS_ENDPOINT, credential=COSMOS_KEY)
        try:
            db = client.create_database_if_not_exists(COSMOS_DB)
        except Exception:  # noqa
            db = client.get_database_client(COSMOS_DB)
        try:
            _cosmos_container = db.create_container_if_not_exists(
                id=COSMOS_CONTAINER, partition_key=PartitionKey(path="/equipment_id"))
        except Exception:  # noqa
            _cosmos_container = db.get_container_client(COSMOS_CONTAINER)
    return _cosmos_container


def storage_mode():
    return "cosmos" if (COSMOS_ENDPOINT and COSMOS_KEY) else "local"


def load_feedback():
    c = _cosmos()
    if c is not None:
        try:
            items = list(c.read_all_items())
            return sorted(items, key=lambda x: x.get("date", ""))
        except Exception:  # noqa
            return []
    if FEEDBACK_PATH.exists():
        with open(FEEDBACK_PATH, encoding="utf-8") as f:
            return json.load(f)
    return []


def save_feedback(item):
    item = {**item, "id": item.get("doc_id") or item.get("id") or _h(json.dumps(item, ensure_ascii=False))}
    c = _cosmos()
    if c is not None:
        c.upsert_item(item)
        return item
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


EMBED_DEPLOYMENT = os.getenv("AZURE_OPENAI_EMBED_DEPLOYMENT", "text-embedding-3-small")
EMBED_CACHE_PATH = ROOT / "data" / "embeddings_cache.json"
_embed_cache = None


def _load_embed_cache():
    global _embed_cache
    if _embed_cache is None:
        try:
            with open(EMBED_CACHE_PATH, encoding="utf-8") as f:
                _embed_cache = json.load(f)
        except Exception:  # noqa
            _embed_cache = {}
    return _embed_cache


def _save_embed_cache():
    try:
        with open(EMBED_CACHE_PATH, "w", encoding="utf-8") as f:
            json.dump(_embed_cache, f)
    except Exception:  # noqa
        pass


def _h(text):
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def embed_texts(texts):
    """埋め込みをキャッシュ付きで返す(未キャッシュ分のみバッチでAPI呼び出し)。"""
    cache = _load_embed_cache()
    missing = list({t for t in texts if _h(t) not in cache})
    if missing:
        client = get_client()
        if client is None:
            raise RuntimeError("AOAI未設定")
        for i in range(0, len(missing), 96):
            chunk = missing[i:i + 96]
            resp = client.embeddings.create(model=EMBED_DEPLOYMENT, input=chunk)
            for t, d in zip(chunk, resp.data):
                cache[_h(t)] = d.embedding
        _save_embed_cache()
    return [cache[_h(t)] for t in texts]


def _cos(a, b):
    s = na = nb = 0.0
    for x, y in zip(a, b):
        s += x * y; na += x * x; nb += y * y
    return s / (math.sqrt(na) * math.sqrt(nb) + 1e-9)


def _pools(corpus, feedback):
    fb_troubles = [{**fb, "source": "feedback", "text": fb.get("text", "")} for fb in feedback]
    return {
        "past_trouble": corpus["past_troubles"] + fb_troubles,
        "procedure": corpus["procedures"],
        "equipment_spec": corpus["equipment_specs"],
        "quality_record": corpus["quality_records"],
    }


def retrieve(corpus, feedback, equipment_id, error_code, free_text, symptom, top_k=5):
    """意味検索(埋め込み) + 設備ID/コード/現場確定のブースト。失敗時は keyword にフォールバック。"""
    pools = _pools(corpus, feedback)
    query = f"設備:{equipment_id} エラーコード:{error_code} 症状:{symptom} {free_text}".strip()
    try:
        all_docs = [d for docs in pools.values() for d in docs]
        texts = [(d.get("text") or " ") for d in all_docs]
        qvec = embed_texts([query])[0]
        dvecs = embed_texts(texts)
        vec_by_id = {id(d): v for d, v in zip(all_docs, dvecs)}

        def score(doc):
            s = _cos(qvec, vec_by_id[id(doc)])
            if equipment_id and doc.get("equipment_id") == equipment_id:
                s += 0.15
            if error_code and error_code.lower() in (doc.get("text", "").lower()):
                s += 0.10
            if doc.get("source") == "feedback":
                s += 0.05
            return s

        results = {}
        for kind, docs in pools.items():
            results[kind] = sorted(docs, key=score, reverse=True)[:top_k]
        return results
    except Exception:  # noqa
        return _retrieve_keyword(pools, equipment_id, error_code, free_text, symptom, top_k)


def _retrieve_keyword(pools, equipment_id, error_code, free_text, symptom, top_k=5):
    query = f"{equipment_id} {error_code} {symptom} {free_text}".lower()
    q_terms = set(t for t in query.replace("　", " ").split() if t)

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


# ===========================================================================
# Action Agent — function calling でAIが自律的にツールを選んで実行する
# ===========================================================================
ACTION_TOOLS = [
    {"type": "function", "function": {
        "name": "escalate_to_maintenance",
        "description": "緊急度Highや品質影響・安全リスクがある場合に、保全チーム(Teams)へ通知してエスカレーションする。Lowでは呼ばない。",
        "parameters": {"type": "object", "properties": {
            "to": {"type": "string", "description": "通知先(例: 保全当番)"},
            "message": {"type": "string", "description": "通知本文(設備/症状/想定原因/初動を1-2行)"},
        }, "required": ["to", "message"]},
    }},
    {"type": "function", "function": {
        "name": "isolate_lot",
        "description": "品質影響の可能性がある場合に、該当時間帯の生産ロットを隔離フラグする。",
        "parameters": {"type": "object", "properties": {
            "reason": {"type": "string", "description": "隔離する理由"},
        }, "required": ["reason"]},
    }},
]


def _exec_tool(name, args, intake, urgency):
    """ツールの実体。Action AgentのツールコールをサーバÅで実行する。"""
    if name == "escalate_to_maintenance":
        sent, text = notify_teams(args.get("message", ""), intake, urgency)
        return {"tool": name, "args": args, "result": ("Teams送信" if sent else "(デモ)通知シミュレート"),
                "detail": text, "executed": True}
    if name == "isolate_lot":
        import datetime
        ticket = f"ISO-{intake.get('equipment_id','LOT')}"
        return {"tool": name, "args": args, "result": f"ロット隔離フラグ発行 {ticket}",
                "detail": args.get("reason", ""), "executed": True}
    return {"tool": name, "args": args, "result": "unknown tool", "executed": False}


def decide_and_act(client, intake, triage):
    """Triage結果を踏まえ、AIが自律的にアクション(ツール)を選んで実行する。"""
    urgency = triage.get("urgency", {}).get("level", "Medium")
    causes = "; ".join(c.get("cause", "") for c in triage.get("root_causes", [])[:3])
    prompt = (f"設備={intake['equipment_name']} 症状={intake['symptom']} 緊急度={urgency}。"
              f"原因候補: {causes}。状況に応じて必要なアクションのツールだけを呼べ。"
              f"緊急度がLowなら何も呼ばなくてよい。")
    msgs = [{"role": "system", "content": "あなたは製造現場のAction Agent。状況に応じ適切なツールのみ自律的に呼ぶ。"},
            {"role": "user", "content": prompt}]
    try:
        resp = client.chat.completions.create(
            model=AOAI_DEPLOYMENT, messages=msgs, tools=ACTION_TOOLS,
            tool_choice="auto", temperature=0, max_tokens=400)
    except Exception as e:  # noqa
        return []
    tcs = resp.choices[0].message.tool_calls or []
    actions = []
    for tc in tcs:
        try:
            args = json.loads(tc.function.arguments or "{}")
        except Exception:  # noqa
            args = {}
        actions.append(_exec_tool(tc.function.name, args, intake, urgency))
    return actions


# ===========================================================================
# Orchestrator — 4エージェントを順に動かし、実行トレースを記録して返す
# ===========================================================================
def orchestrate(client, intake, image_b64=None, use_feedback=True):
    """エンジン切替: TRIAGE_ENGINE=foundry なら Foundry connected agents、
    失敗時/未設定時は自作オーケストレーション(local)に自動フォールバック。"""
    engine = os.getenv("TRIAGE_ENGINE", "local").lower()
    if engine == "foundry":
        try:
            import foundry_engine
            if foundry_engine.available():
                return foundry_engine.orchestrate_foundry(intake, image_b64, use_feedback)
        except Exception as e:  # noqa
            local = orchestrate_local(client, intake, image_b64, use_feedback)
            local.setdefault("trace", []).insert(0, {
                "agent": "System", "title": "Foundryフォールバック",
                "detail": f"Foundry実行に失敗しlocalエンジンで継続: {str(e)[:120]}"})
            local["engine"] = "local (foundry fallback)"
            return local
    return orchestrate_local(client, intake, image_b64, use_feedback)


def orchestrate_local(client, intake, image_b64=None, use_feedback=True):
    corpus = load_corpus()
    all_feedback = load_feedback()
    feedback = all_feedback if use_feedback else []
    trace = []

    # 1. Intake
    trace.append({"agent": "Intake", "title": "入力を構造化",
                  "detail": f"設備={intake['equipment_name']} / 症状={intake['symptom']} / "
                            f"コード={intake.get('error_code','-')} / 画像={'有' if image_b64 else '無'}"})

    # 2. Retrieval
    results = retrieve(corpus, feedback, intake["equipment_id"], intake.get("error_code", ""),
                       intake.get("free_text", ""), intake.get("symptom", ""))
    counts = {LABEL[k]: len(v) for k, v in results.items()}
    fb_used = sum(1 for docs in results.values() for d in docs if d.get("source") == "feedback")
    trace.append({"agent": "Retrieval", "title": "資料を横断検索",
                  "detail": "  ".join(f"{k}:{v}" for k, v in counts.items()) +
                            f"  / 現場確定事例 {fb_used}件" + ("" if use_feedback else " (フィードバック未使用)")})

    # 3. Triage
    triage = run_triage(client, intake, results, image_b64)
    rc = triage.get("root_causes", [{}])
    trace.append({"agent": "Triage", "title": "緊急度・原因を判断",
                  "detail": f"緊急度={triage.get('urgency',{}).get('level','-')} / "
                            f"第一候補={rc[0].get('cause','-') if rc else '-'} "
                            f"({int(rc[0].get('confidence',0)*100) if rc else 0}%)"})

    # 4. Action (function calling — AIが自律的にツール実行)
    actions = decide_and_act(client, intake, triage)
    if actions:
        trace.append({"agent": "Action", "title": "アクションを自律実行(function calling)",
                      "detail": " / ".join(f"{a['tool']}→{a['result']}" for a in actions)})
    else:
        trace.append({"agent": "Action", "title": "アクション判断",
                      "detail": "緊急度が低く、自動アクションは不要と判断"})

    triage["trace"] = trace
    triage["actions"] = actions
    triage["feedback_used"] = fb_used
    triage["use_feedback"] = use_feedback
    triage["engine"] = "local"
    triage["specialist_findings"] = []
    return triage


def followup(client, intake, question, use_feedback=True):
    """トリアージ後のフォローアップ質問に、資料を根拠に回答する。"""
    corpus = load_corpus()
    feedback = load_feedback() if use_feedback else []
    results = retrieve(corpus, feedback, intake.get("equipment_id", ""), intake.get("error_code", ""),
                       f"{intake.get('free_text','')} {question}", intake.get("symptom", ""))
    context = build_context(results)
    resp = client.chat.completions.create(
        model=AOAI_DEPLOYMENT,
        messages=[
            {"role": "system", "content": "渡された資料だけを根拠に、現場担当の質問へ簡潔に答える。推測で断定しない。"},
            {"role": "user", "content": f"対象設備:{intake.get('equipment_name','')}\n資料:\n{context}\n\n質問:{question}"},
        ], temperature=0.2, max_tokens=600)
    return resp.choices[0].message.content
