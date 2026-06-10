"""channel — choose channels, send window and cadence.

Wraps **phase3 / agent_13 (Channel Strategy)**: decides the channel mix, the
optimal send window and the cadence for each lead's sequence.

``run_channel_strategy`` is re-exported unchanged from phase3, so the phase3
channel-strategy tests cover this module.
"""
from __future__ import annotations

from phase3.agents.agent_13_channel_strategy import run_channel_strategy

__all__ = ["run_channel_strategy"]
