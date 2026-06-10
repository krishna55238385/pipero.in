"""copywriter — write the outreach email sequence.

Wraps **phase3 / agent_12 (Copywriter)**: writes a 5-step sequence with two
variants per step, using each lead's personalisation angles.

``run_copywriting`` is re-exported unchanged from phase3, so the phase3
copywriting tests cover this module.
"""
from __future__ import annotations

from phase3.agents.agent_12_copywriter import run_copywriting

__all__ = ["run_copywriting"]
