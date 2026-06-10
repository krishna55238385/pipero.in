# Phases

The AI GTM Agency is built in 8 phases. Phase 1 (FIND) is complete; phases 2-8 are TBD and will be added incrementally.

| #   | Phase    | Status          | Agents              | Purpose                                           |
| --- | -------- | --------------- | ------------------- | ------------------------------------------------- |
| 1   | FIND     | ✅ Complete     | 5 (agent_01 — _05)  | ICP → leads → enrichment → signals → scoring      |
| 2   | TBD      | 🔲 Planned      | ~6                  | TBD                                               |
| 3   | TBD      | 🔲 Planned      | ~6                  | TBD                                               |
| 4   | TBD      | 🔲 Planned      | ~6                  | TBD                                               |
| 5   | TBD      | 🔲 Planned      | ~6                  | TBD                                               |
| 6   | TBD      | 🔲 Planned      | ~6                  | TBD                                               |
| 7   | TBD      | 🔲 Planned      | ~6                  | TBD                                               |
| 8   | TBD      | 🔲 Planned      | ~6                  | TBD                                               |

Total expected agents: ~45-50 across 8 phases.

## Conventions

### Naming
- Agent IDs are **globally unique across all phases**: phase 1 uses `agent_01` through `agent_05`, phase 2 will use `agent_06` onward, etc.
- File naming: `phase{N}/agents/agent_{NN}_{short_name}.py`.
- Phase code lives in its own top-level directory: `phase1/`, `phase2/`, etc.
- Each phase package has the same internal structure: `agents/`, `connectors/`, `core/`, `data/`, `tests/`.

### Phase tracking in `llm_usage`
- Every `llm.chat_json(...)` call MUST pass `phase="phase{N}"`.
- The `phase` column on `llm_usage` is indexed for fast aggregation.
- The dashboard's "By Phase" view auto-discovers new phases — no code changes required when a phase comes online.

## Onboarding a new phase

When you start building phase N:

1. **Create the package skeleton:**
   ```bash
   mkdir -p phase{N}/{agents,connectors,core,data,tests}
   touch phase{N}/__init__.py phase{N}/__main__.py phase{N}/main.py phase{N}/README.md
   ```

2. **Define agent IDs** continuing from the previous phase. E.g. if phase 1 ended at `agent_05`, phase 2 starts at `agent_06`.

3. **In every agent**, when calling `llm.chat_json`, pass the new phase tag:
   ```python
   raw = llm.chat_json(SYSTEM_PROMPT, user_prompt, agent="agent_06_xyz", phase="phase2")
   ```

4. **Add tests** under `phase{N}/tests/` following the conventions in `phase1/tests/conftest.py`:
   - Stub `OPENAI_API_KEY`, `SERP_API_KEY`, `SUPABASE_URL`, `SUPABASE_KEY` to fake values at import time.
   - Mock all outbound APIs with `respx` or `unittest.mock.patch`.
   - At minimum: one test per agent, one e2e pipeline test, one test for any new scoring/heuristic logic.

5. **Run the new test suite:**
   ```bash
   pytest phase{N}/tests/ -v
   ```

6. **Verify dashboard pickup.** Run a few agents to log some `llm_usage` rows, then check:
   - `curl http://localhost:8000/api/usage/by-phase` returns the new phase.
   - The dashboard "By Phase" tab shows the new phase automatically.

7. **Update this file** — change the row for phase N from `🔲 Planned` to `✅ Complete` and fill in the agent count and purpose.

## Anti-patterns

- Do NOT hardcode the list of phases anywhere in the backend or frontend. Phase discovery must be data-driven (read from `llm_usage`).
- Do NOT reuse agent IDs across phases. `agent_03` in phase 1 ≠ `agent_03` in phase 2 — give phase 2 fresh IDs (`agent_06`+).
- Do NOT skip the `phase=` argument on `chat_json` — without it, usage rows land in `phase = NULL`, which the dashboard surfaces as `"unknown"`.
