"""personalize — generate per-lead personalisation angles.

Wraps **phase3 / agent_11 (Personalisation)**: derives the hooks/angles used to
tailor outreach to each lead (from account intel, signals and stakeholder data).

``run_personalisation`` is re-exported unchanged from phase3, so the phase3
personalisation tests cover this module.
"""
from __future__ import annotations

from phase3.agents.agent_11_personalisation import run_personalisation

__all__ = ["run_personalisation"]
