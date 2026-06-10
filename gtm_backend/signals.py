"""signals — detect buying signals for leads.

Wraps **phase1 / agent_04 (Buying Signal Detection)**: scans recent news for
funding, product launches, acquisitions, layoffs and other intent keywords and
writes rows to ``buying_signals``.

``detect_signals`` is re-exported unchanged from phase1, so the phase1
signal-detection tests cover this module.
"""
from __future__ import annotations

from phase1.agents.agent_04_signals import detect_signals

__all__ = ["detect_signals"]
