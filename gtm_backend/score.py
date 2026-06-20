"""score — rank leads against the ICP rubric.

Wraps **phase1 / agent_05 (ICP Scoring)**: the deterministic scoring rubric
that combines fit and buying-signal intent into an ``icp_score`` and a tier
(hot/warm/cool). Hot leads can auto-promote into the CRM.

``score_leads`` is re-exported unchanged from phase1, so the phase1 scoring
tests cover this module.
"""
from __future__ import annotations

from gtm_backend.phase1.agents.agent_05_scoring import score_leads

__all__ = ["score_leads"]
