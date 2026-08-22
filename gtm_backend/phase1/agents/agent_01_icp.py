"""Agent 01 — ICP Definition.

Takes a free-text prompt and produces a structured ICP saved to icp_profiles.
"""
from gtm_backend.phase1.connectors import openai as llm
from gtm_backend.phase1.connectors import supabase
from gtm_backend.phase1.core.prompts import ICP_DEFINITION_SYSTEM
from gtm_backend.phase1.core.schemas import ICP
from gtm_backend.phase3.connectors import supabase as crm_supabase

_DEFAULT_PRODUCT_LINE = "Core"


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
    # ICP.product_line has a Pydantic field default of "Core", but that
    # default only applies when the key is *missing* from raw — the prompt
    # tells the LLM to default to "Core" itself when no product is
    # mentioned, but the LLM sometimes returns an explicit
    # `"product_line": null` instead of actually writing "Core", and an
    # explicit None bypasses the field default entirely, crashing
    # model_validate with a hard ValidationError (found live 2026-08-22,
    # prompting only described the target customer, never the seller's own
    # product). Backfilled here, in priority order: the org's own configured
    # product description (Settings — see get_current_org_product_description,
    # the same field Agent 05's lookalike finder already reads), then the
    # schema's own "Core" default, so a missing product is never fatal.
    if not raw.get("product_line"):
        raw["product_line"] = crm_supabase.get_current_org_product_description() or _DEFAULT_PRODUCT_LINE

    icp = ICP.model_validate(raw)
    print(f"  → Validated ICP schema: '{icp.name}'")
    icp_id = supabase.insert_icp(icp, user_prompt=prompt)
    print(f"  ✓ Agent 01 complete: ICP '{icp.name}' inserted (id={icp_id})")
    return icp_id
