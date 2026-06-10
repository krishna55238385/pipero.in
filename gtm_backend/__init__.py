"""gtm_backend — the dedicated backend for the pipero GTM product.

This package is a *clean, feature-named facade* over the existing
``phase1`` / ``phase2`` / ``phase3`` pipelines. Each feature module
(``find_leads``, ``enrich``, ``score``, ``account_intel``, ``competitive``,
``send`` …) is a thin re-export of the corresponding ``phaseN/agents/agent_NN``
function, so behaviour is **identical** and every one of the existing tests
stays valid.

Why this exists
---------------
``phase1/2/3`` are named after delivery phases, not capabilities. New code,
the FastAPI service and the unified CLI should talk in product terms
("find leads", "enrich", "score", "send") rather than "phase 1 agent 03".
``gtm_backend`` gives the product one obvious home with self-documenting
names while the original phase packages keep running unchanged.

Relationship to other top-level folders
---------------------------------------
* ``gtm_backend/`` (this package) — the **product** backend: the GTM pipeline
  the customer's leads flow through.
* ``backend/`` + ``frontend/`` — the **internal** LLM-usage / cost dashboard
  (an Anthropic/OpenAI usage monitor), not the GTM pipeline.
* ``gtm_service/`` — the deploy-time FastAPI trigger service the CRM calls;
  ``gtm_backend.service`` mirrors its public HTTP surface in-process.

Import-safe: importing this package or any feature module does not execute a
pipeline. Settings (OpenAI / SerpAPI / Supabase keys) are read from the single
root ``.env`` via the existing ``phaseN.core.config`` — no new configuration.

See ``README.md`` for the full old→new name map.
"""
from __future__ import annotations

__version__ = "1.0.0"

# Feature names exposed at the package root. Each maps 1:1 to an existing
# phaseN agent function (see the per-module docstrings and README map).
__all__ = [
    # FIND (phase1)
    "find_leads",
    "enrich",
    "signals",
    "score",
    # UNDERSTAND (phase2)
    "account_intel",
    "stakeholders",
    "competitive",
    "market_sizing",
    "gtm_brief",
    # REACH (phase3)
    "personalize",
    "copywriter",
    "channel",
    "send",
    "ab_testing",
    # Surfaces
    "service",
]
