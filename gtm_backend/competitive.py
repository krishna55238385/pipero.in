"""competitive — gather competitive intelligence per ICP.

Wraps **phase2 / agent_08 (Competitive Intelligence)**: discovers and profiles
competitors for an ICP (positioning, pricing, strengths/weaknesses) for use in
outreach differentiation.

``gather_competitive_intel`` is re-exported unchanged from phase2, so the
phase2 competitive tests cover this module.
"""
from __future__ import annotations

from gtm_backend.phase2.agents.agent_08_competitive import gather_competitive_intel

__all__ = ["gather_competitive_intel"]
