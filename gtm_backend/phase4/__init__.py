"""Phase 4 — CONVERT. Turns qualified conversation into a CRM pipeline.

Agent 24: Deal Qualification
Agent 25: Proposal Generation
Agent 26: Proposal Follow-up
Agent 27: Executive Engagement
Agent 33: Pipeline Management (MANAGE & REPORT — also lives here since it
shares the same deals/Groq/RDS infra; no separate phase5/ folder needed)

Deliberately thin: reuses phase3's proven Groq client (connectors/openai.py)
and RDS client (connectors/supabase.py) rather than duplicating them — the
DB and LLM account are shared across every phase, only the agent logic here
is new.
"""
__version__ = "4.0.0"
