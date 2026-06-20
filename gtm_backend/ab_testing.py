"""ab_testing — score outreach variants from live analytics.

Wraps **phase3 / agent_15 (A/B Testing)**: pulls Instantly campaign analytics
and scores the A/B variants of each sequence step to pick winners.

``run_ab_testing`` is re-exported unchanged from phase3, so the phase3
A/B-testing tests cover this module.
"""
from __future__ import annotations

from gtm_backend.phase3.agents.agent_15_ab_testing import run_ab_testing

__all__ = ["run_ab_testing"]
