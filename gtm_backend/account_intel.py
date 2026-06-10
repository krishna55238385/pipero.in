"""account_intel — build per-account intelligence briefs.

Wraps **phase2 / agent_06 (Account Intelligence)**: researches each target
account (tech stack, news, hiring, financials) and writes a structured brief to
``account_intelligence``.

``build_account_intelligence`` is re-exported unchanged from phase2, so the
phase2 account-intel tests cover this module.
"""
from __future__ import annotations

from phase2.agents.agent_06_account_intel import build_account_intelligence

__all__ = ["build_account_intelligence"]
