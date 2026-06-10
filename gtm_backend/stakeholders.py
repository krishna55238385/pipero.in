"""stakeholders — map the buying committee for each account.

Wraps **phase2 / agent_07 (Stakeholders)**: identifies the decision-makers,
champions and blockers per account and stores them in ``account_stakeholders``.

``map_stakeholders`` is re-exported unchanged from phase2, so the phase2
stakeholder tests cover this module.
"""
from __future__ import annotations

from phase2.agents.agent_07_stakeholders import map_stakeholders

__all__ = ["map_stakeholders"]
