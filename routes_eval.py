"""評価(S2)の API ルーター。
server.py に `from routes_eval import router as eval_router; app.include_router(eval_router)` を1行追加で有効化。"""
from fastapi import APIRouter, HTTPException

import evaluation

router = APIRouter(prefix="/api/eval", tags=["eval"])


@router.post("/run")
def run(use_feedback: bool = True):
    try:
        return evaluation.run_eval(use_feedback)
    except Exception as e:  # noqa
        raise HTTPException(500, f"評価失敗: {e}")
