"""send — dispatch outreach via Instantly or direct Gmail.

Wraps **phase3 / agent_14 (Orchestrator)**: the send step of the REACH
pipeline. Two send paths are supported, matching the phase3 CLI ``--sender``:

* :func:`run_orchestration` — hand the leads off to an Instantly campaign
  (default path).
* :func:`run_gmail_orchestration` — send the intro email of each sequence
  directly over Gmail SMTP (the self-hosted path ported from an n8n workflow).

:func:`send_outreach` is a convenience dispatcher selecting the path by
``sender`` (``"instantly"`` | ``"gmail"``).

The underlying functions are re-exported unchanged from phase3, so the phase3
orchestration / Gmail tests cover this module.
"""
from __future__ import annotations

from phase3.agents.agent_14_orchestrator import (
    run_gmail_orchestration,
    run_orchestration,
)

__all__ = ["run_orchestration", "run_gmail_orchestration", "send_outreach"]


def send_outreach(
    icp_id: int | None = None,
    limit: int | None = None,
    dry_run: bool = False,
    sender: str = "instantly",
) -> dict:
    """Send outreach for ``icp_id`` via ``sender`` (``"instantly"`` | ``"gmail"``).

    Mirrors the phase3 ``run-all`` send-step branching.
    """
    if sender == "gmail":
        return run_gmail_orchestration(icp_id, limit, dry_run)
    if sender == "instantly":
        return run_orchestration(icp_id, limit, dry_run)
    raise ValueError(f"unknown sender: {sender!r} (expected 'instantly' or 'gmail')")
