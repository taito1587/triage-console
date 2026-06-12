"""Manufacturing Triage Agent — FastAPI バックエンド。
/api/* でトリアージAPIを提供し、frontend/dist のReact(Mantine)アプリを配信する。"""
import uuid
from pathlib import Path
from collections import Counter, defaultdict

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import triage_core as core
from .routes_incident import router as incident_router
from .routes_eval import router as eval_router

app = FastAPI(title="Manufacturing Triage Agent")
app.include_router(incident_router)
app.include_router(eval_router)
ROOT = Path(__file__).parent.parent
DIST = ROOT / "frontend" / "dist"


class Intake(BaseModel):
    equipment_id: str
    process: str = ""
    error_code: str = ""
    symptom: str = "その他"
    free_text: str = ""
    image_b64: str | None = None
    use_feedback: bool = True


class FollowupReq(BaseModel):
    equipment_id: str
    equipment_name: str = ""
    error_code: str = ""
    symptom: str = ""
    free_text: str = ""
    question: str
    use_feedback: bool = True


class Feedback(BaseModel):
    equipment_id: str
    error_code: str = ""
    symptom: str = ""
    root_cause: str
    action_taken: str = ""
    recovery_minutes: int = 0
    ai_was_correct: str = "当たり"
    note: str = ""
    date: str = ""


class NotifyReq(BaseModel):
    equipment_id: str
    equipment_name: str
    symptom: str
    urgency: str
    message: str


@app.get("/api/meta")
def meta():
    corpus = core.load_corpus()
    return {
        "equipments": [{"id": e["equipment_id"], "name": e["equipment_name"],
                        "process": e.get("process", "")} for e in corpus["equipment_specs"]],
        "symptom_categories": core.SYMPTOM_CATEGORIES,
        "aoai_ready": bool(core.AOAI_ENDPOINT and core.AOAI_KEY),
        "deployment": core.AOAI_DEPLOYMENT,
        "teams_ready": bool(core.TEAMS_WEBHOOK_URL),
    }


@app.post("/api/triage")
def triage(intake: Intake):
    client = core.get_client()
    if client is None:
        raise HTTPException(503, "Azure OpenAI が未設定です")
    corpus = core.load_corpus()
    equip_map = {e["equipment_id"]: e["equipment_name"] for e in corpus.get("equipment_specs", [])}
    intake_d = intake.model_dump()
    intake_d["equipment_name"] = equip_map.get(intake.equipment_id, intake.equipment_id)
    try:
        out = core.orchestrate(client, intake_d, intake.image_b64, intake.use_feedback)
    except Exception as e:  # noqa
        raise HTTPException(500, f"トリアージ失敗: {e}")
    return out


@app.post("/api/followup")
def followup(req: FollowupReq):
    client = core.get_client()
    if client is None:
        raise HTTPException(503, "Azure OpenAI が未設定です")
    intake_d = req.model_dump()
    try:
        ans = core.followup(client, intake_d, req.question, req.use_feedback)
    except Exception as e:  # noqa
        raise HTTPException(500, f"回答失敗: {e}")
    return {"answer": ans}


@app.post("/api/followup/stream")
def followup_stream(req: FollowupReq):
    from fastapi.responses import StreamingResponse
    client = core.get_client()
    if client is None:
        raise HTTPException(503, "Azure OpenAI が未設定です")
    intake_d = req.model_dump()

    def gen():
        try:
            for delta in core.followup_stream(client, intake_d, req.question, req.use_feedback):
                yield delta
        except Exception:  # noqa  ストリーム途中の失敗はメッセージで通知
            yield "\n（回答の生成中にエラーが発生しました）"

    return StreamingResponse(gen(), media_type="text/plain; charset=utf-8",
                             headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"})


@app.post("/api/feedback")
def feedback(fb: Feedback):
    import datetime
    today = fb.date or datetime.date.today().isoformat()
    item = {
        "doc_id": f"fb-{today}-{fb.equipment_id}-{uuid.uuid4().hex[:6]}", "equipment_id": fb.equipment_id,
        "date": today, "line": "現場登録", "symptom": fb.symptom, "error_code": fb.error_code,
        "root_cause": fb.root_cause, "action_taken": fb.action_taken,
        "recovery_minutes": fb.recovery_minutes, "ai_was_correct": fb.ai_was_correct,
        "responder_note": fb.note,
        "text": (f"{today} {fb.equipment_id} {fb.symptom} {fb.error_code}。"
                 f"原因={fb.root_cause}。対処={fb.action_taken}。復旧{fb.recovery_minutes}分。{fb.note}"),
    }
    core.save_feedback(item)
    return {"ok": True, "item": item}


@app.post("/api/transcribe")
async def transcribe(file: UploadFile = File(...)):
    client = core.get_client()
    if client is None:
        raise HTTPException(503, "Azure OpenAI が未設定です")
    data = await file.read()
    if len(data) > 25 * 1024 * 1024:  # Whisper の上限に合わせる(過大アップロード/OOM防止)
        raise HTTPException(413, "音声ファイルが大きすぎます（25MB 以下にしてください）")
    if file.content_type and not file.content_type.startswith(("audio", "video", "application/octet-stream")):
        raise HTTPException(415, "音声ファイルを指定してください")
    try:
        text = core.transcribe(data, file.filename or "audio.webm")
    except Exception as e:  # noqa
        raise HTTPException(500, f"文字起こし失敗: {e}")
    return {"text": text}


SYMPTOM_KW = [("異音", ["異音", "音"]), ("停止", ["停止", "止ま", "ジャム", "詰ま", "滞留"]),
              ("温度異常", ["温度", "発熱", "過熱", "オーバーヒート"]),
              ("品質不良", ["品質", "不良", "ズレ", "ずれ", "ばらつき", "漏れ", "剥が", "偏差"]),
              ("振動", ["振動"])]


def _symptom_cat(s):
    s = s or ""
    for cat, kws in SYMPTOM_KW:
        if any(k in s for k in kws):
            return cat
    return "その他"


@app.get("/api/knowledge")
def knowledge():
    corpus = core.load_corpus()
    fb = core.load_feedback()
    troubles = corpus.get("past_troubles", []) + fb
    rec = [t.get("recovery_minutes", 0) for t in troubles if t.get("recovery_minutes")]
    avg = round(sum(rec) / len(rec), 1) if rec else 0
    causes = Counter(t.get("root_cause", "不明") for t in troubles)
    equips = Counter(t.get("equipment_id", "-") for t in troubles)
    codes = Counter(t.get("error_code", "") for t in troubles if t.get("error_code"))
    symptoms = Counter(_symptom_cat(t.get("symptom", "")) for t in troubles)
    top = sorted(troubles, key=lambda x: x.get("recovery_minutes", 0), reverse=True)[:5]

    # 月別トレンド(件数 + 平均復旧時間)
    mb = defaultdict(lambda: {"count": 0, "rec": []})
    for t in troubles:
        m = (t.get("date", "") or "")[:7]
        if not m:
            continue
        mb[m]["count"] += 1
        if t.get("recovery_minutes"):
            mb[m]["rec"].append(t["recovery_minutes"])
    by_month = [{"month": m, "count": v["count"],
                 "avg_recovery": round(sum(v["rec"]) / len(v["rec"]), 1) if v["rec"] else 0}
                for m, v in sorted(mb.items())]

    # 設備別 平均復旧時間
    er = defaultdict(list)
    for t in troubles:
        if t.get("recovery_minutes"):
            er[t.get("equipment_id", "-")].append(t["recovery_minutes"])
    equip_recovery = sorted(
        [{"equipment": k, "avg": round(sum(v) / len(v), 1), "count": len(v)} for k, v in er.items()],
        key=lambda x: x["avg"], reverse=True)

    # 学習(現場確定事例数・AI的中率)
    judged = [f for f in fb if f.get("ai_was_correct") in ("当たり", "部分的", "外れ")]
    hit = [f for f in judged if f.get("ai_was_correct") in ("当たり", "部分的")]
    ai_hit_rate = round(100 * len(hit) / len(judged)) if judged else None

    order = ["異音", "停止", "温度異常", "品質不良", "振動", "その他"]
    return {
        "total": len(troubles), "avg_recovery": avg,
        "estimated_saved_minutes": len(troubles) * 12,
        "feedback_count": len(fb), "ai_hit_rate": ai_hit_rate,
        "top_causes": [{"cause": c, "count": n} for c, n in causes.most_common(6)],
        "by_equipment": [{"equipment": k, "count": v} for k, v in equips.most_common()],
        "by_code": [{"code": c, "count": n} for c, n in codes.most_common(6)],
        "by_symptom": [{"symptom": s, "count": symptoms.get(s, 0)} for s in order if symptoms.get(s, 0)],
        "by_month": by_month,
        "equip_recovery": equip_recovery,
        "longest": [{"date": t.get("date", ""), "equipment_id": t.get("equipment_id", ""),
                     "cause": t.get("root_cause", ""), "minutes": t.get("recovery_minutes", 0)}
                    for t in top],
    }


@app.post("/api/notify")
def notify(req: NotifyReq):
    try:
        sent, text = core.notify_teams(req.message,
                                       {"equipment_name": req.equipment_name, "symptom": req.symptom},
                                       req.urgency)
    except Exception:  # noqa  webhook 障害などで全体を 500 トレースにしない
        raise HTTPException(502, "通知の送信に失敗しました")
    return {"sent": sent, "text": text}


# --- 静的配信 (React/Mantine ビルド成果物) ----------------------------------
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/")
    def index():
        return FileResponse(DIST / "index.html")

    @app.get("/{path:path}")
    def spa(path: str):
        # 未知の /api/* は SPA(index.html)で握りつぶさず 404 を返す
        if path == "api" or path.startswith("api/"):
            raise HTTPException(404, "not found")
        f = (DIST / path).resolve()
        if f.is_file() and f.is_relative_to(DIST.resolve()):
            return FileResponse(f)
        return FileResponse(DIST / "index.html")
