# gtm_backend — the pipero GTM product backend

`gtm_backend` is the **one clean, feature-named home** for the Python GTM
pipeline. It is a thin facade over the existing `phase1` / `phase2` / `phase3`
packages: every feature module imports and re-exports the corresponding
`phaseN/agents/agent_NN` function, so **behaviour is identical** and all the
existing phase tests stay valid. The names describe *capabilities*
(`find_leads`, `enrich`, `score`, `send`) instead of delivery phases.

## What this is — and what it is not

| Folder | Role |
|---|---|
| **`gtm_backend/`** (this) | The **product** backend — the GTM pipeline a customer's leads flow through. New code, the unified CLI and the FastAPI service live here. |
| `backend/` + `frontend/` | The **internal** dashboard — an LLM / API **usage & cost monitor** for the team. Not the GTM pipeline. |
| `gtm_service/` | The **deploy-time trigger service** the pipero.in CRM calls (it shells out to `python -m phaseN`). `gtm_backend.service` mirrors its HTTP surface but runs the stages **in-process**. |
| `phase1/2/3/` | The original implementation packages. **Unchanged** — `gtm_backend` wraps them. |

Settings (OpenAI / SerpAPI / Supabase keys) are read from the single root
`.env` via the existing `phaseN.core.config` — no new configuration. Importing
`gtm_backend` (or any feature module) never runs a pipeline.

## Old → new name map

### FIND (phase 1)
| Feature module | Wraps | Key function(s) |
|---|---|---|
| `gtm_backend/find_leads.py` | phase1 agent_01 + agent_02 | `define_icp`, `generate_leads`, `find_leads` |
| `gtm_backend/enrich.py` | phase1 agent_03 | `enrich_leads` |
| `gtm_backend/signals.py` | phase1 agent_04 | `detect_signals` |
| `gtm_backend/score.py` | phase1 agent_05 | `score_leads` |

### UNDERSTAND (phase 2)
| Feature module | Wraps | Key function(s) |
|---|---|---|
| `gtm_backend/account_intel.py` | phase2 agent_06 | `build_account_intelligence` |
| `gtm_backend/stakeholders.py` | phase2 agent_07 | `map_stakeholders` |
| `gtm_backend/competitive.py` | phase2 agent_08 | `gather_competitive_intel` |
| `gtm_backend/market_sizing.py` | phase2 agent_09 | `size_markets` |
| `gtm_backend/gtm_brief.py` | phase2 agent_10 | `generate_insights`, `approve_insights` |

### REACH (phase 3)
| Feature module | Wraps | Key function(s) |
|---|---|---|
| `gtm_backend/personalize.py` | phase3 agent_11 | `run_personalisation` |
| `gtm_backend/copywriter.py` | phase3 agent_12 | `run_copywriting` |
| `gtm_backend/channel.py` | phase3 agent_13 | `run_channel_strategy` |
| `gtm_backend/send.py` | phase3 agent_14 | `run_orchestration`, `run_gmail_orchestration`, `send_outreach` |
| `gtm_backend/ab_testing.py` | phase3 agent_15 | `run_ab_testing` |

### Surfaces
| File | Role |
|---|---|
| `gtm_backend/__main__.py` | Unified, feature-named CLI (`python -m gtm_backend …`). |
| `gtm_backend/service.py` | FastAPI app — `/run/find`, `/run/understand`, `/run/reach`, `/health` (+ `/run/phase1\|2\|3` aliases). |
| `gtm_backend/test_smoke.py` | Imports every feature module + asserts each facade resolves. |

## Unified CLI

```bash
# FIND
python -m gtm_backend find --prompt "Series B fintechs in the EU" --max 20
python -m gtm_backend enrich  --icp 1 --limit 50
python -m gtm_backend signals --icp 1
python -m gtm_backend score   --mode icp_id --icp 1
python -m gtm_backend find-all --prompt "..." --max 20      # ICP→leads→enrich→signals→score

# UNDERSTAND
python -m gtm_backend account-intel --icp 1
python -m gtm_backend competitive   --icp 1 --max 5
python -m gtm_backend gtm-brief      --icp 1
python -m gtm_backend approve-brief  --all --icp 1
python -m gtm_backend understand-all --icp 1                 # full phase-2 chain

# REACH
python -m gtm_backend personalize --icp 1
python -m gtm_backend send --icp 1 --sender gmail --dry-run
python -m gtm_backend reach-all --icp 1 --sender instantly   # full phase-3 chain
```

Each subcommand maps 1:1 to a feature module and is equivalent to the matching
`python -m phaseN …` command.

## HTTP service

```bash
export GTM_TRIGGER_TOKEN=dev-token        # required for /run/* auth
uvicorn gtm_backend.service:app --reload --port 8080

curl -s localhost:8080/health
curl -s -X POST localhost:8080/run/find \
  -H "Authorization: Bearer dev-token" -H "Content-Type: application/json" \
  -d '{"prompt":"Series B fintechs in the EU","max":20}'
```

`/run/find` accepts `{prompt}` (Apollo-style) **or** `{icp_id}`; `/run/understand`
and `/run/reach` take `{icp_id, limit, …}`. Every request may carry
`organization_id`, which is set as `GTM_ORG_ID` for the run so the phase
connectors tag every inserted row for that CRM tenant (same behaviour as
`gtm_service`). The legacy `/run/phase1|phase2|phase3` paths are kept as
aliases. Unlike `gtm_service`, this app runs the stages **in-process** (no
subprocess, no `phase_runs` tracking) — use `gtm_service` when you need the
queued/background run tracking the CRM polls.

## Tests

```bash
.venv/bin/python -m pytest gtm_backend/test_smoke.py -q     # 22 passed
```

The smoke test only imports — it makes no network/Supabase calls. The full
existing suite (phase1/2/3 + gtm_service) remains green with `gtm_backend`
present (the only red test is the pre-existing `test_supabase_url_is_reachable`
live-network check, unrelated to this package).

## Status / follow-up

This is the **logical** new home; it is a facade only. The original
`phase1/2/3` packages are intentionally **not deleted yet** — the physical
migration (moving agent implementations into `gtm_backend` and pointing
`gtm_service` at it) is the follow-up. Until then, both the phase CLIs and this
backend work side by side against the same code.
