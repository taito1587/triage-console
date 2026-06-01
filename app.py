"""
Manufacturing Triage Agent — Streamlit single-app MVP
Microsoft Agent Hackathon 2026

現場の異常入力に対し、Azure OpenAI が過去トラブル/手順書/設備仕様/品質記録を
横断して「緊急度・原因候補Top3・初動確認・類似事例・推奨アクション」を返す
現場判断支援エージェント。
"""
import os
import json
import base64
import datetime
from pathlib import Path

import streamlit as st
from openai import AzureOpenAI

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:  # noqa
    pass

# ----------------------------------------------------------------------------
# 設定
# ----------------------------------------------------------------------------
ROOT = Path(__file__).parent
CORPUS_PATH = ROOT / "data" / "corpus.json"
FEEDBACK_PATH = ROOT / "data" / "feedback.json"

AOAI_ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT", "")
AOAI_KEY = os.getenv("AZURE_OPENAI_API_KEY", "")
AOAI_DEPLOYMENT = os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4o")
AOAI_API_VERSION = os.getenv("AZURE_OPENAI_API_VERSION", "2024-10-21")
TEAMS_WEBHOOK_URL = os.getenv("TEAMS_WEBHOOK_URL", "")

SYMPTOM_CATEGORIES = ["異音", "停止", "温度異常", "品質不良", "振動", "その他"]


@st.cache_data
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
    with open(FEEDBACK_PATH, "w", encoding="utf-8") as f:
        json.dump(fb, f, ensure_ascii=False, indent=2)


def get_client():
    if not (AOAI_ENDPOINT and AOAI_KEY):
        return None
    return AzureOpenAI(
        azure_endpoint=AOAI_ENDPOINT,
        api_key=AOAI_KEY,
        api_version=AOAI_API_VERSION,
    )


# ----------------------------------------------------------------------------
# Retrieval Agent — コーパス + 現場フィードバックから関連資料を集める
# ----------------------------------------------------------------------------
def retrieve(corpus, feedback, equipment_id, error_code, free_text, symptom, top_k=5):
    """超軽量ハイブリッド: 設備ID/エラーコード一致 + キーワード重なりでスコアリング。"""
    query = f"{equipment_id} {error_code} {symptom} {free_text}".lower()
    q_terms = set(t for t in query.replace("　", " ").split() if t)

    # 現場フィードバックを past_troubles として合流 ("使うほど賢くなる")
    fb_troubles = [
        {**fb, "source": "feedback", "text": fb.get("text", "")} for fb in feedback
    ]
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
            s += 2  # 現場確定事例を優先
        return s

    results = {}
    for kind, docs in pools.items():
        ranked = sorted(docs, key=score, reverse=True)
        results[kind] = [d for d in ranked if score(d) > 0][:top_k]
    return results


# ----------------------------------------------------------------------------
# Triage Agent — 構造化トリアージ出力
# ----------------------------------------------------------------------------
TRIAGE_SCHEMA_HINT = """
必ず次のJSONスキーマで返答してください(日本語):
{
  "urgency": {"level": "High|Medium|Low", "reason": "判断理由"},
  "root_causes": [{"rank":1,"cause":"...","evidence":"参照根拠","confidence":0.0-1.0}],
  "first_checks": [{"order":1,"action":"..."}],
  "similar_cases": [{"title":"...","date":"YYYY-MM-DD","cause":"...","recovery_minutes":0,"note":"..."}],
  "recommended_actions": ["..."],
  "escalation": {"should_notify": true/false, "to": "保全/品質保証/リーダー", "message": "通知文(1-2行)"},
  "image_findings": "画像から読み取れた所見(なければnull)"
}
root_causesは最大3件、確信度の高い順。first_checksは現場が最初にやる順。
similar_casesは渡された過去トラブル/フィードバックから関連するものを抽出。
"""

SYSTEM_PROMPT = """あなたは製造現場のトリアージ支援エージェントです。
渡された「設備仕様・作業手順書・過去トラブル・品質記録・現場フィードバック」だけを根拠に判断し、
推測で断定しないこと。根拠は必ず渡された資料に紐づけること。
緊急度はライン停止/品質影響/安全リスクの観点で判断する。
出力は指定JSONのみ(前後に余計な文章を付けない)。"""


def build_context(results):
    lines = []
    label = {
        "past_trouble": "過去トラブル",
        "procedure": "作業手順書",
        "equipment_spec": "設備仕様",
        "quality_record": "品質記録",
    }
    for kind, docs in results.items():
        for d in docs:
            tag = "【現場確定】" if d.get("source") == "feedback" else ""
            lines.append(f"[{label[kind]}{tag}] id={d.get('doc_id','-')}: {d.get('text','')}")
    return "\n".join(lines)


def run_triage(client, intake, results, image_bytes=None):
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
    if image_bytes:
        b64 = base64.b64encode(image_bytes).decode()
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
        })
        content[0]["text"] += "\n# 添付画像\n画像を解析し、摩耗痕/異物/エラー表示などの所見を image_findings に記載し判断に反映すること。"

    resp = client.chat.completions.create(
        model=AOAI_DEPLOYMENT,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": content},
        ],
        response_format={"type": "json_object"},
        temperature=0.2,
        max_tokens=1500,
    )
    return json.loads(resp.choices[0].message.content)


def notify_teams(message, intake, urgency):
    """加点A: 保全へTeamsエスカレーションをAgentが実行。Webhook未設定時はシミュレート。"""
    text = (f"🚨 製造トリアージ通知 [{urgency}]\n"
            f"設備: {intake['equipment_name']} / 症状: {intake['symptom']}\n{message}")
    if not TEAMS_WEBHOOK_URL:
        return False, text
    import urllib.request
    payload = json.dumps({"text": text}).encode()
    req = urllib.request.Request(
        TEAMS_WEBHOOK_URL, data=payload, headers={"Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=10)
        return True, text
    except Exception as e:  # noqa
        return False, f"{text}\n(送信失敗: {e})"


# ----------------------------------------------------------------------------
# UI
# ----------------------------------------------------------------------------
st.set_page_config(page_title="Manufacturing Triage Agent", page_icon="🏭", layout="wide")
corpus = load_corpus()

st.title("🏭 Manufacturing Triage Agent")
st.caption("製造現場の異常を、AIエージェントが過去トラブル・手順書・設備仕様・品質記録を横断して即トリアージ")

with st.sidebar:
    st.subheader("デモシナリオ")
    st.markdown(
        "- 設備: **第2ライン 搬送コンベア (L2-CONV-01)**\n"
        "- エラーコード: **E-142** / 症状: **異音**\n"
        "- 文脈: 直前に段取り替え・温度上昇")
    ok = bool(AOAI_ENDPOINT and AOAI_KEY)
    st.markdown("---")
    st.markdown(f"Azure OpenAI: {'🟢 接続OK' if ok else '🔴 未設定 (環境変数)'}")
    st.markdown(f"デプロイ: `{AOAI_DEPLOYMENT}`")
    st.markdown(f"Teams通知: {'🟢 Webhook設定済' if TEAMS_WEBHOOK_URL else '⚪ シミュレート'}")

tab_triage, tab_fb, tab_know = st.tabs(["🚨 トリアージ", "✍️ フィードバック", "📊 ナレッジ集計"])

# --- Tab 1: 入力 + 結果 ---------------------------------------------------
with tab_triage:
    equip_map = {e["equipment_id"]: e["equipment_name"] for e in corpus["equipment_specs"]}
    col_in, col_out = st.columns([1, 2])

    with col_in:
        st.subheader("異常入力")
        with st.form("intake"):
            eq_id = st.selectbox("設備", list(equip_map.keys()),
                                 format_func=lambda x: f"{equip_map[x]} ({x})")
            process = st.text_input("工程", value="搬送")
            err = st.text_input("エラーコード", value="E-142")
            symptom = st.selectbox("症状カテゴリ", SYMPTOM_CATEGORIES)
            free_text = st.text_area("自由記述", value="搬送部から異音。温度上昇あり。直前に段取り替え。")
            image = st.file_uploader("画像 (任意 / GPT-4o visionで解析)", type=["jpg", "jpeg", "png"])
            submitted = st.form_submit_button("🔎 トリアージ実行", use_container_width=True)

    with col_out:
        if submitted:
            client = get_client()
            if client is None:
                st.error("Azure OpenAI が未設定です。環境変数 AZURE_OPENAI_ENDPOINT / _API_KEY を設定してください。")
            else:
                intake = {"equipment_id": eq_id, "equipment_name": equip_map[eq_id],
                          "process": process, "error_code": err, "symptom": symptom,
                          "free_text": free_text}
                feedback = load_feedback()
                with st.spinner("エージェントが資料を横断して判断中..."):
                    results = retrieve(corpus, feedback, eq_id, err, free_text, symptom)
                    img_bytes = image.getvalue() if image else None
                    try:
                        out = run_triage(client, intake, results, img_bytes)
                    except Exception as e:  # noqa
                        st.error(f"トリアージ失敗: {e}")
                        out = None

                if out:
                    st.session_state["last_intake"] = intake
                    st.session_state["last_result"] = out

                    # まず何をするか(最上部)
                    lvl = out.get("urgency", {}).get("level", "Medium")
                    color = {"High": "🔴", "Medium": "🟡", "Low": "🟢"}.get(lvl, "🟡")
                    st.markdown(f"### {color} 緊急度: {lvl}")
                    st.info(out.get("urgency", {}).get("reason", ""))

                    fc = out.get("first_checks", [])
                    if fc:
                        st.markdown("#### ✅ まず確認すること")
                        for c in fc:
                            st.markdown(f"**{c.get('order','-')}.** {c.get('action','')}")

                    rc = out.get("root_causes", [])
                    if rc:
                        st.markdown("#### 🔍 原因候補 Top3")
                        for c in rc:
                            conf = int(float(c.get("confidence", 0)) * 100)
                            st.markdown(f"**{c.get('rank','-')}. {c.get('cause','')}** (確信度 {conf}%)")
                            st.caption(f"根拠: {c.get('evidence','')}")
                            st.progress(min(conf, 100))

                    ra = out.get("recommended_actions", [])
                    if ra:
                        st.markdown("#### 🚀 推奨アクション")
                        for a in ra:
                            st.markdown(f"- {a}")

                    # 加点A: エスカレーション実行
                    esc = out.get("escalation", {})
                    if esc.get("should_notify"):
                        st.markdown("#### 📣 エスカレーション")
                        st.warning(f"宛先: {esc.get('to','保全')} / {esc.get('message','')}")
                        if st.button("保全へTeams通知を実行", type="primary"):
                            sent, msg = notify_teams(esc.get("message", ""), intake, lvl)
                            st.success("Teamsへ送信しました" if sent else "（デモ）通知内容をシミュレート表示")
                            st.code(msg)

                    sc = out.get("similar_cases", [])
                    if sc:
                        st.markdown("#### 📚 類似事例")
                        for s in sc:
                            st.markdown(
                                f"- **{s.get('date','')}** {s.get('title','')} → "
                                f"原因: {s.get('cause','')} / 復旧 {s.get('recovery_minutes','?')}分"
                                f" — {s.get('note','')}")

                    if out.get("image_findings"):
                        st.markdown("#### 🖼️ 画像所見 (vision)")
                        st.write(out["image_findings"])

                    # 加点: 根拠(参照資料)
                    with st.expander("🔎 根拠詳細 (参照した資料)"):
                        label = {"past_trouble": "過去トラブル", "procedure": "作業手順書",
                                 "equipment_spec": "設備仕様", "quality_record": "品質記録"}
                        for kind, docs in results.items():
                            for d in docs:
                                tag = " 【現場確定】" if d.get("source") == "feedback" else ""
                                st.markdown(f"**[{label[kind]}{tag}]** `{d.get('doc_id','-')}`")
                                st.caption(d.get("text", ""))
        else:
            st.info("左で異常を入力して「トリアージ実行」を押してください。")

# --- Tab 2: フィードバック ------------------------------------------------
with tab_fb:
    st.subheader("現場フィードバック登録")
    st.caption("実際の結果を登録すると、次回以降の検索対象に入り精度が上がります（使うほど賢くなる）。")
    last = st.session_state.get("last_intake")
    with st.form("fb"):
        eq = st.text_input("設備ID", value=(last or {}).get("equipment_id", "L2-CONV-01"))
        err = st.text_input("エラーコード", value=(last or {}).get("error_code", "E-142"))
        symptom = st.text_input("症状", value=(last or {}).get("symptom", "異音"))
        real_cause = st.text_input("実際の原因", value="搬送ローラー摩耗")
        action = st.text_input("実施した対処", value="駆動ローラー交換")
        recovery = st.number_input("復旧時間(分)", min_value=0, value=22)
        correct = st.selectbox("AI回答は当たっていたか", ["当たり", "部分的", "外れ"])
        note = st.text_area("追加メモ", value="")
        fb_sub = st.form_submit_button("登録")
    if fb_sub:
        today = datetime.date.today().isoformat()
        item = {
            "doc_id": f"fb-{today}-{eq}",
            "equipment_id": eq, "date": today, "line": "現場登録",
            "symptom": symptom, "error_code": err,
            "root_cause": real_cause, "action_taken": action,
            "recovery_minutes": recovery, "ai_was_correct": correct,
            "responder_note": note,
            "text": f"{today} {eq} {symptom} {err}。原因={real_cause}。対処={action}。復旧{recovery}分。{note}",
        }
        save_feedback(item)
        st.success("登録しました。次回のトリアージから現場確定事例として参照されます。")
        st.json(item)

# --- Tab 3: ナレッジ集計 (加点C: ROI) --------------------------------------
with tab_know:
    st.subheader("現場ナレッジ集計")
    troubles = corpus["past_troubles"] + load_feedback()
    if troubles:
        rec = [t.get("recovery_minutes", 0) for t in troubles if t.get("recovery_minutes")]
        avg = round(sum(rec) / len(rec), 1) if rec else 0
        c1, c2, c3 = st.columns(3)
        c1.metric("登録トラブル件数", len(troubles))
        c2.metric("平均復旧時間", f"{avg} 分")
        # 加点C: ROI試算 (初動短縮の想定値)
        saved_per = 12  # 初動判断短縮(分/件)の想定
        c3.metric("初動短縮によるDT削減(試算)", f"{len(troubles) * saved_per} 分/月相当")

        st.markdown("#### よくある原因ランキング")
        from collections import Counter
        causes = Counter(t.get("root_cause", "不明") for t in troubles)
        for cause, n in causes.most_common(5):
            st.markdown(f"- {cause}: {n}件")

        st.markdown("#### 設備別トラブル件数")
        eqc = Counter(t.get("equipment_id", "-") for t in troubles)
        st.bar_chart({k: v for k, v in eqc.items()})

        st.markdown("#### 復旧時間 上位")
        for t in sorted(troubles, key=lambda x: x.get("recovery_minutes", 0), reverse=True)[:5]:
            st.markdown(f"- {t.get('date','')} {t.get('equipment_id','')} "
                        f"{t.get('root_cause','')} → {t.get('recovery_minutes','?')}分")
    else:
        st.info("データがありません。")
    st.caption("※ ROI試算は初動判断短縮の想定値。ダウンタイム1分=数千〜数万円のラインを想定。")
