"""Manufacturing Triage Agent — FastAPI バックエンド。
/api/* でトリアージAPIを提供し、frontend/dist のReact(Mantine)アプリを配信する。"""
import uuid
from pathlib import Path
from collections import Counter

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import triage_core as core
from routes_incident import router as incident_router
from routes_eval import router as eval_router

app = FastAPI(title="Manufacturing Triage Agent")
app.include_router(incident_router)
app.include_router(eval_router)
ROOT = Path(__file__).parent
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
    equip_map = {e["equipment_id"]: e["equipment_name"] for e in corpus["equipment_specs"]}
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
    try:
        text = core.transcribe(data, file.filename or "audio.webm")
    except Exception as e:  # noqa
        raise HTTPException(500, f"文字起こし失敗: {e}")
    return {"text": text}


@app.get("/api/knowledge")
def knowledge():
    corpus = core.load_corpus()
    troubles = corpus["past_troubles"] + core.load_feedback()
    rec = [t.get("recovery_minutes", 0) for t in troubles if t.get("recovery_minutes")]
    avg = round(sum(rec) / len(rec), 1) if rec else 0
    causes = Counter(t.get("root_cause", "不明") for t in troubles)
    equips = Counter(t.get("equipment_id", "-") for t in troubles)
    top = sorted(troubles, key=lambda x: x.get("recovery_minutes", 0), reverse=True)[:5]
    return {
        "total": len(troubles), "avg_recovery": avg,
        "estimated_saved_minutes": len(troubles) * 12,
        "top_causes": [{"cause": c, "count": n} for c, n in causes.most_common(6)],
        "by_equipment": [{"equipment": k, "count": v} for k, v in equips.items()],
        "longest": [{"date": t.get("date", ""), "equipment_id": t.get("equipment_id", ""),
                     "cause": t.get("root_cause", ""), "minutes": t.get("recovery_minutes", 0)}
                    for t in top],
    }


@app.post("/api/notify")
def notify(req: NotifyReq):
    sent, text = core.notify_teams(req.message,
                                   {"equipment_name": req.equipment_name, "symptom": req.symptom},
                                   req.urgency)
    return {"sent": sent, "text": text}


# --- 静的配信 (React/Mantine ビルド成果物) ----------------------------------
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/")
    def index():
        return FileResponse(DIST / "index.html")

    @app.get("/{path:path}")
    def spa(path: str):
        f = (DIST / path).resolve()
        if f.is_file() and f.is_relative_to(DIST.resolve()):
            return FileResponse(f)
        return FileResponse(DIST / "index.html")
