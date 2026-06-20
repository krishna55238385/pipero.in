"""gtm_brief — synthesise per-account GTM briefs and gate their approval.

Wraps **phase2 / agent_10 (GTM Insights)**: combines account intel, the buying
committee, competitive intel and signals into a single per-account GTM brief,
plus the human-review approval gate.

* :func:`generate_insights` — produce the briefs (status ``pending_review``).
* :func:`approve_insights` — the human-review gate that promotes a brief to the
  active strategy.

Both are re-exported unchanged from phase2, so the phase2 GTM-insight tests
cover this module.
"""
from __future__ import annotations

from gtm_backend.phase2.agents.agent_10_gtm_insights import approve_insights, generate_insights

__all__ = ["generate_insights", "approve_insights"]
