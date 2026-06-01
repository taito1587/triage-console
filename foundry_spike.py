"""Foundry Agent Service: connected agents の実機検証スパイク。
主(Orchestrator)→ サブ(品質影響スペシャリスト) を connected agent で繋ぎ、
1スレッド実行して応答と run steps(トレース) が取れるか確認する。"""
import os
from azure.ai.agents import AgentsClient
from azure.ai.agents.models import ConnectedAgentTool
from azure.identity import DefaultAzureCredential
from dotenv import load_dotenv

load_dotenv()
EP = os.environ["FOUNDRY_PROJECT_ENDPOINT"]
MODEL = os.getenv("FOUNDRY_MODEL", "gpt-4o")

client = AgentsClient(endpoint=EP, credential=DefaultAzureCredential())
print("instance sub-clients:", [a for a in dir(client) if a in
      ("threads", "messages", "runs", "run_steps")])

created = []
try:
    # サブエージェント: 品質影響スペシャリスト
    sub = client.create_agent(model=MODEL, name="quality_impact_specialist",
        instructions="製造異常の状況から品質影響(ロット隔離要否)を簡潔に判定する専門家。")
    created.append(sub.id)
    print("sub agent:", sub.id)

    connected = ConnectedAgentTool(id=sub.id, name="quality_impact",
        description="品質影響の有無とロット隔離要否を判定する")

    # 主エージェント: トリアージ・オーケストレータ
    main = client.create_agent(model=MODEL, name="triage_orchestrator",
        instructions=("製造現場のトリアージ責任者。緊急度と初動を判断し、"
                      "品質影響の判定が必要なら quality_impact を使うこと。"),
        tools=connected.definitions)
    created.append(main.id)
    print("main agent:", main.id)

    prompt = ("第2ライン 搬送コンベア(L2-CONV-01)でE-142・搬送部から異音・温度上昇。"
              "直前に段取り替え。過去に同症状でローラー摩耗→25分で復旧の記録あり。"
              "緊急度・初動・品質影響を判断して。")
    run = client.create_thread_and_process_run(
        agent_id=main.id,
        thread={"messages": [{"role": "user", "content": prompt}]})
    print("run status:", run.status, "| thread:", run.thread_id)

    # 応答メッセージ
    msgs = client.messages.list(thread_id=run.thread_id)
    for m in msgs:
        if m.role == "assistant":
            for c in m.content:
                if getattr(c, "text", None):
                    print("ASSISTANT:", c.text.value[:300]); break
            break

    # run steps (トレース取得可否)
    steps = list(client.run_steps.list(thread_id=run.thread_id, run_id=run.id))
    print(f"run steps: {len(steps)}")
    for s in steps:
        print("  step:", s.type, "status:", s.status)
finally:
    for aid in created:
        try: client.delete_agent(aid)
        except Exception: pass
    print("cleaned up agents")
