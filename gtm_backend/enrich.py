"""enrich — add contacts and verified/pattern emails to leads.

Wraps **phase1 / agent_03 (Lead Enrichment)**: free-stack + Groq + DNS
discovery enrichment that attaches a primary contact and a verified or
pattern email to each lead.

``enrich_leads`` is re-exported unchanged from phase1, so the phase1
enrichment tests cover this module.
"""
from __future__ import annotations

from gtm_backend.phase1.agents.agent_03_enrichment import enrich_leads

__all__ = ["enrich_leads"]
