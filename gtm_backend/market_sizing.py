"""market_sizing — produce the weekly ranked market map.

Wraps **phase2 / agent_09 (Weekly Market Sizing)**: aggregates the pipeline
into a ranked TAM/SAM/SOM-style market view (Supabase RPC + OpenAI).

``size_markets`` is re-exported unchanged from phase2, so the phase2
market-sizing tests cover this module.
"""
from __future__ import annotations

from gtm_backend.phase2.agents.agent_09_market_sizing import size_markets

__all__ = ["size_markets"]
