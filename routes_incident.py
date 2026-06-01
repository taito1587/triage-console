"""自律インシデント・ボードの API ルーター (R1/S1/S3)。
server.py に `from routes_incident import router as incident_router; app.include_router(incident_router)`
を1行追加するだけで有効化される（server.py 本体は変更不要）。"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import incident as inc

router = APIRouter(prefix="/api/incidents", tags=["incidents"])


class IngestReq(BaseModel):
    events: list[dict]


class ResolveReq(BaseModel):
    root_cause: str
    recovery_minutes: int = 0
    note: str = ""
    ai_was_correct: str = "当たり"
    by: str = "現場担当"


class ApproveReq(BaseModel):
    approver: str = "現場責任者"


@router.get("")
def list_board(status: str | None = None):
    return {"incidents": inc.board(status), "kpi": inc.kpi()}


@router.get("/kpi")
def get_kpi():
    return inc.kpi()


@router.post("/ingest_sample")
def ingest_sample():
    try:
        created = inc.ingest_sample()
    except RuntimeError:
        raise HTTPException(503, "Azure OpenAI が未設定のため取り込めません")
    except FileNotFoundError:
        raise HTTPException(500, "サンプルアラームが見つかりません")
    return {"ingested": len(created), "kpi": inc.kpi()}


@router.post("/ingest")
def ingest(req: IngestReq):
    try:
        created = inc.ingest(req.events)
    except RuntimeError:
        raise HTTPException(503, "Azure OpenAI が未設定のため取り込めません")
    return {"ingested": len(created), "kpi": inc.kpi()}


@router.post("/{incident_id}/approve")
def approve(incident_id: str, req: ApproveReq):
    try:
        return inc.approve(incident_id, req.approver)
    except KeyError:
        raise HTTPException(404, "incident not found")
    except inc.InvalidState as e:
        raise HTTPException(409, str(e))


@router.post("/{incident_id}/resolve")
def resolve(incident_id: str, req: ResolveReq):
    try:
        return inc.resolve(incident_id, req.root_cause, req.recovery_minutes,
                           req.note, req.ai_was_correct, req.by)
    except KeyError:
        raise HTTPException(404, "incident not found")
    except inc.InvalidState as e:
        raise HTTPException(409, str(e))


@router.post("/clear")
def clear():
    inc.clear_all()
    return {"ok": True}
