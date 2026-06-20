"""find_leads — define an ICP and generate matching company leads.

Wraps **phase1 / agent_01 (ICP) + agent_02 (Lead Generation)**.

* :func:`define_icp` — turn a natural-language prompt into a stored ICP row,
  returning its integer id (phase1 agent_01 ``define_icp``).
* :func:`generate_leads` — populate company lead records for an ICP
  (phase1 agent_02 ``generate_leads``).
* :func:`find_leads` — convenience: define the ICP from a prompt, then generate
  leads for it; returns ``(icp_id, leads_result)``. This is the same chaining
  the phase1 ``run-all`` CLI does for its first two steps.

Thin facade: the imported functions ARE the phase1 implementations, so the
existing phase1 tests cover this module's behaviour.
"""
from __future__ import annotations

from gtm_backend.phase1.agents.agent_01_icp import define_icp
from gtm_backend.phase1.agents.agent_02_leads import generate_leads

__all__ = ["define_icp", "generate_leads", "find_leads"]


def find_leads(prompt: str, max_leads: int = 20) -> tuple[int, dict]:
    """Define an ICP from ``prompt`` then generate up to ``max_leads`` companies.

    Returns ``(icp_id, generate_leads_result)``.
    """
    icp_id = define_icp(prompt)
    result = generate_leads(icp_id, max_leads)
    return icp_id, result
