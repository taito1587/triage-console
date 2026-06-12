"""評価(S2)の API ルーター。"""
from fastapi import APIRouter, HTTPException

from . import evaluation

router = APIRouter(prefix="/api/eval", tags=["eval"])


@router.post("/run")
def run(use_feedback: bool = True):
    try:
        return evaluation.run_eval(use_feedback)
    except Exception as e:  # noqa
        raise HTTPException(500, f"評価失敗: {e}")
