"""AOAI 接続 + トリアージ出力の疎通テスト(デモシナリオ E-142)。"""
import os, json
from pathlib import Path
from dotenv import load_dotenv
from openai import AzureOpenAI

load_dotenv()
ROOT = Path(__file__).parent
corpus = json.load(open(ROOT / "data" / "corpus.json", encoding="utf-8"))

client = AzureOpenAI(
    azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
    api_key=os.environ["AZURE_OPENAI_API_KEY"],
    api_version=os.getenv("AZURE_OPENAI_API_VERSION", "2024-10-21"),
)

# E-142 シナリオに関連する資料を抜粋(簡易)
docs = []
for d in corpus["past_troubles"] + corpus["procedures"] + corpus["equipment_specs"] + corpus["quality_records"]:
    if d.get("equipment_id") in ("L2-CONV-01", "COMMON"):
        docs.append(d.get("text", ""))
context = "\n".join(f"- {t}" for t in docs)

user = f"""# 現場入力
設備: 第2ライン 搬送コンベア (L2-CONV-01) / 工程: 搬送
エラーコード: E-142 / 症状: 異音
自由記述: 搬送部から異音。温度上昇あり。直前に段取り替え。

# 参照資料(これだけを根拠にする)
{context}

必ず次のJSONで返答: {{"urgency":{{"level":"High|Medium|Low","reason":"..."}},
"root_causes":[{{"rank":1,"cause":"...","evidence":"...","confidence":0.0}}],
"first_checks":[{{"order":1,"action":"..."}}],
"similar_cases":[{{"title":"...","date":"...","cause":"...","recovery_minutes":0,"note":"..."}}],
"recommended_actions":["..."],"escalation":{{"should_notify":true,"to":"...","message":"..."}},
"image_findings":null}}"""

resp = client.chat.completions.create(
    model=os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4o"),
    messages=[
        {"role": "system", "content": "あなたは製造現場のトリアージ支援エージェント。渡された資料のみを根拠に判断しJSONのみ返す。"},
        {"role": "user", "content": user},
    ],
    response_format={"type": "json_object"},
    temperature=0.2, max_tokens=1200,
)
out = json.loads(resp.choices[0].message.content)
print("=== 接続OK / トリアージ結果 ===")
print("緊急度:", out["urgency"]["level"], "-", out["urgency"]["reason"])
print("原因候補:")
for c in out.get("root_causes", []):
    print(f"  {c['rank']}. {c['cause']} (確信度{int(c['confidence']*100)}%) 根拠: {c['evidence']}")
print("初動:", [c["action"] for c in out.get("first_checks", [])])
print("類似事例:", [f"{s.get('date')} {s.get('cause')} {s.get('recovery_minutes')}分" for s in out.get("similar_cases", [])])
print("エスカレーション:", out.get("escalation"))
print("\n[OK] AOAI接続・JSON構造化出力ともに成功")
