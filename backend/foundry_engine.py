"""Azure AI Foundry Agent Service (connected agents) による トリアージエンジン。

ローカルRAGで根拠を集め、Foundryの「主エージェント + connected サブエージェント」に
渡してトリアージを実行。run steps を取得して実行トレースに変換する。
失敗時は呼び出し側(triage_core.orchestrate)が自作エンジンへフォールバックする。
"""
import os
import json
import re

from . import triage_core as core

FOUNDRY_ENDPOINT = os.getenv("FOUNDRY_PROJECT_ENDPOINT", "")
FOUNDRY_MODEL = os.getenv("FOUNDRY_MODEL", "gpt-4o")

_client = None
_orchestrator_id = None

ORCH_NAME = "mta_triage_orchestrator"
SUB_QUALITY = "mta_quality_impact_specialist"
SUB_MAINT = "mta_maintenance_planner"


def available():
    return bool(FOUNDRY_ENDPOINT)


def _get_client():
    global _client
    if _client is None:
        from azure.ai.agents import AgentsClient
        from azure.identity import DefaultAzureCredential
        _client = AgentsClient(endpoint=FOUNDRY_ENDPOINT, credential=DefaultAzureCredential())
    return _client


def _find_agent(client, name):
    for a in client.list_agents():
        if getattr(a, "name", None) == name:
            return a.id
    return None


def _ensure_agents():
    """connected agents (主+サブ2体) を get-or-create してオーケストレータIDを返す。"""
    global _orchestrator_id
    if _orchestrator_id:
        return _orchestrator_id
    from azure.ai.agents.models import ConnectedAgentTool
    client = _get_client()

    quality_id = _find_agent(client, SUB_QUALITY) or client.create_agent(
        model=FOUNDRY_MODEL, name=SUB_QUALITY,
        instructions=(
            "あなたは製造現場の品質影響スペシャリスト。与えられた異常状況と参照資料から、"
            "製品品質への影響とロット隔離の要否を判定する。\n"
            "出力は4行以内で簡潔に: 1)品質影響: 有/無/要確認 2)理由 3)ロット隔離: 要/不要 "
            "4)確認すべき品質指標。長文や前置きは禁止。")).id
    maint_id = _find_agent(client, SUB_MAINT) or client.create_agent(
        model=FOUNDRY_MODEL, name=SUB_MAINT,
        instructions=(
            "あなたは製造設備の保全プランナー。想定原因に対する具体的な点検・処置と、"
            "保全エスカレーションの要否/宛先を助言する。\n"
            "出力は箇条書き5行以内: 最優先の点検/処置を順に、最後に『エスカレーション: 要(宛先)/不要』。"
            "長文や一般論は禁止、現場が今すぐ動ける具体策のみ。")).id

    orch_id = _find_agent(client, ORCH_NAME)
    if not orch_id:
        quality_tool = ConnectedAgentTool(id=quality_id, name="quality_impact",
            description="品質影響の有無とロット隔離要否を判定する")
        maint_tool = ConnectedAgentTool(id=maint_id, name="maintenance_planner",
            description="想定原因への点検・処置と保全エスカレーションを助言する")
        orch_id = client.create_agent(
            model=FOUNDRY_MODEL, name=ORCH_NAME,
            instructions=(
                "あなたは製造現場のトリアージ責任者(Orchestrator)です。\n"
                "渡された現場入力と参照資料(過去トラブル/手順/設備仕様/品質記録)だけを根拠に判断し、推測で断定しない。\n"
                "品質影響の判定は quality_impact を、保全の点検/処置/エスカレーションは maintenance_planner を必ず参照すること。\n"
                "最終出力は必ず次のJSONのみ(前後に文章を付けない):\n" + core.TRIAGE_SCHEMA_HINT),
            tools=quality_tool.definitions + maint_tool.definitions).id
    _orchestrator_id = orch_id
    return orch_id


def _parse_json(text):
    try:
        return json.loads(text)
    except Exception:  # noqa
        m = re.search(r"\{.*\}", text, re.S)
        if m:
            return json.loads(m.group(0))
        raise


def orchestrate_foundry(intake, image_b64=None, use_feedback=True):
    client = _get_client()
    orch_id = _ensure_agents()

    # 1. ローカルRAG(根拠収集)
    corpus = core.load_corpus()
    feedback = core.load_feedback() if use_feedback else []
    results = core.retrieve(corpus, feedback, intake["equipment_id"], intake.get("error_code", ""),
                            intake.get("free_text", ""), intake.get("symptom", ""))
    context = core.build_context(results)
    fb_used = sum(1 for docs in results.values() for d in docs if d.get("source") == "feedback")

    user_msg = (f"# 現場入力\n設備:{intake['equipment_name']}({intake['equipment_id']}) 工程:{intake.get('process','')}\n"
                f"エラーコード:{intake.get('error_code','')} 症状:{intake.get('symptom','')}\n"
                f"自由記述:{intake.get('free_text','')}\n\n# 参照資料(これだけを根拠に)\n{context}")

    # 2. Foundry connected agents 実行
    run = client.create_thread_and_process_run(
        agent_id=orch_id, thread={"messages": [{"role": "user", "content": user_msg}]})
    if str(run.status).upper().endswith("FAILED"):
        raise RuntimeError(f"Foundry run failed: {getattr(run,'last_error',None)}")

    # 応答(JSON)を取得
    answer = ""
    for m in client.messages.list(thread_id=run.thread_id):
        if m.role == "assistant":
            for c in m.content:
                if getattr(c, "text", None):
                    answer = c.text.value
                    break
            if answer:
                break
    triage = _parse_json(answer)

    # citations を付加(ローカルRAG由来)
    triage["citations"] = [
        {"source_type": kind, "label": core.LABEL[kind], "doc_id": d.get("doc_id", "-"),
         "text": d.get("text", ""), "is_feedback": d.get("source") == "feedback"}
        for kind, docs in results.items() for d in docs]

    # 3. 実行トレース(run steps + 我々の前処理)
    trace = [
        {"agent": "Intake", "title": "入力を構造化",
         "detail": f"設備={intake['equipment_name']} / 症状={intake.get('symptom','')} / コード={intake.get('error_code','-')}"},
        {"agent": "Retrieval", "title": "資料を横断検索(ローカルRAG)",
         "detail": "  ".join(f"{core.LABEL[k]}:{len(v)}" for k, v in results.items()) + f"  / 現場確定 {fb_used}件"},
    ]
    findings = []
    try:
        steps = list(client.run_steps.list(thread_id=run.thread_id, run_id=run.id))
        steps = sorted(steps, key=lambda s: getattr(s, "created_at", 0) or 0)
        for s in steps:
            stype = str(getattr(s, "type", ""))
            if "tool_call" in stype.lower():
                for f in _tool_findings(s):
                    label = SPECIALIST_LABEL.get(f["name"], f["name"])
                    findings.append({"name": f["name"], "label": label, "output": f["output"]})
                    snippet = " ".join((f["output"] or "").split())[:60]
                    trace.append({"agent": "Orchestrator", "title": f"{label} へ委譲",
                                  "detail": f"Foundry connected agent: {snippet}…" if snippet else f"{label} を呼び出し"})
            elif "message" in stype.lower():
                trace.append({"agent": "Triage", "title": "主エージェントが統合・判断",
                              "detail": f"緊急度={triage.get('urgency',{}).get('level','-')} / 2体の専門エージェントの所見を統合"})
    except Exception:  # noqa
        trace.append({"agent": "Triage", "title": "主エージェントが判断", "detail": "Foundry connected agents"})
    triage["specialist_findings"] = findings

    # 4. アクション(提案のみ) — HITL一本化により実行はインシデント・ボードの承認に集約
    actions = []
    esc = triage.get("escalation", {}) or {}
    if esc.get("should_notify"):
        actions.append({"tool": "escalate_to_maintenance", "args": {"to": esc.get("to", "保全")},
                        "result": "提案(承認待ち)",
                        "detail": esc.get("message", ""),
                        "to": esc.get("to", "保全"),
                        "executed": False})
    trace.append({"agent": "Action",
                  "title": "アクション提案" if actions else "アクション判断",
                  "detail": (" / ".join(f"{a['tool']}→{a['result']}" for a in actions)
                             or "自動アクションは不要と判断")})

    triage["trace"] = trace
    triage["actions"] = actions
    triage["feedback_used"] = fb_used
    triage["use_feedback"] = use_feedback
    triage["engine"] = "foundry"
    return triage


SPECIALIST_LABEL = {
    "quality_impact": "品質影響スペシャリスト",
    "maintenance_planner": "保全プランナー",
}


def _as_dict(obj):
    if isinstance(obj, dict):
        return obj
    if hasattr(obj, "as_dict"):
        try:
            return obj.as_dict()
        except Exception:  # noqa
            pass
    return None


def _tool_findings(step):
    """run step の connected agent tool call から {name, output, arguments} を抽出。"""
    out = []
    try:
        details = getattr(step, "step_details", None)
        tcs = getattr(details, "tool_calls", None)
        if tcs is None:
            d = _as_dict(step) or {}
            tcs = (d.get("step_details") or {}).get("tool_calls") or []
        for tc in tcs:
            d = _as_dict(tc) or {}
            ca = d.get("connected_agent") or {}
            name = ca.get("name") or d.get("name")
            if name:
                out.append({"name": name, "output": ca.get("output") or "",
                            "arguments": ca.get("arguments") or ""})
    except Exception:  # noqa
        pass
    return out
