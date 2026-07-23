"""Phase 4 — CONVERT. Turns qualified conversation into a CRM pipeline.

Agent 22: Deal Qualification

Deliberately thin: reuses phase3's proven Groq client (connectors/openai.py)
and RDS client (connectors/supabase.py) rather than duplicating them — the
DB and LLM account are shared across every phase, only the agent logic here
is new.
"""
__version__ = "4.0.0"
