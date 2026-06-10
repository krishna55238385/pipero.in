"""Agent 01 — ICP Definition.

Takes a free-text prompt and produces a structured ICP saved to icp_profiles.
"""
from phase1.connectors import openai as llm
from phase1.connectors import supabase
from phase1.core.prompts import ICP_DEFINITION_SYSTEM
from phase1.core.schemas import ICP


def define_icp(prompt: str) -> int:
    """Define a new ICP from prompt and persist it. Returns the inserted icp_id."""
    if not prompt or not prompt.strip():
        raise ValueError("prompt must not be empty")

    bar = "═" * 72
    print(f"\n{bar}")
    print("  AGENT 01 — ICP Definition")
    print(bar)
    print(f"  → Parsing prompt ({len(prompt)} chars)")

    raw = llm.chat_json(ICP_DEFINITION_SYSTEM, prompt, agent="agent_01_icp", phase="phase1")
    icp = ICP.model_validate(raw)
    print(f"  → Validated ICP schema: '{icp.name}'")
    icp_id = supabase.insert_icp(icp, user_prompt=prompt)
    print(f"  ✓ Agent 01 complete: ICP '{icp.name}' inserted (id={icp_id})")
    return icp_id
