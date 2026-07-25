"""Regression guard for a recurring bug class: a column declared JSONB in a
phase's schema.sql that isn't registered in that phase's own supabase.py
_JSONB_COLUMNS crashes with psycopg2.ProgrammingError: can't adapt type
'dict'/'list' the first time an agent actually writes a dict/list into it —
but every existing unit test mocks the supabase connector, so nothing catches
the gap until it's hit live.

This has happened 3 times in phase3 so far (deal_breakdown, cost_by_phase/
channel_breakdown, related_lead_ids) — each time found live on EC2 or by a
sharp-eyed diff review, never by the test suite. This test root-causes it:
parse every JSONB column each phase's schema.sql actually declares, and fail
if any of them is missing from that SAME phase's _JSONB_COLUMNS.

Each phase (phase1/phase2/phase3) has its OWN independent connector module
with its OWN independent _JSONB_COLUMNS set (they were migrated from Supabase
REST to direct Postgres separately) — a column is checked against the set
that actually governs the file that declares it, not phase3's set applied
everywhere.

If this test fails, the fix is almost always: add the column name to that
phase's _JSONB_COLUMNS in <phase>/connectors/supabase.py, not to change
schema.sql.
"""
import importlib
import re
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent

# (schema.sql path, dotted module path to that phase's connector) pairs.
_PHASES = [
    ("phase1", _REPO_ROOT / "phase1" / "data" / "schema.sql", "gtm_backend.phase1.connectors.supabase"),
    ("phase2", _REPO_ROOT / "phase2" / "data" / "schema.sql", "gtm_backend.phase2.connectors.supabase"),
    ("phase3", _REPO_ROOT / "phase3" / "data" / "schema.sql", "gtm_backend.phase3.connectors.supabase"),
]

# Matches "<column_name> JSONB" wherever it appears — covers both
# `CREATE TABLE (... col JSONB DEFAULT ...)` and
# `ALTER TABLE t ADD COLUMN IF NOT EXISTS col JSONB DEFAULT ...` forms, since
# both put the column name immediately before the JSONB type keyword.
_JSONB_COLUMN_DECL = re.compile(r"(\w+)\s+JSONB\b")


def _declared_jsonb_columns(schema_path: Path) -> set[str]:
    if not schema_path.exists():
        return set()
    return set(_JSONB_COLUMN_DECL.findall(schema_path.read_text(encoding="utf-8")))


def test_every_schema_jsonb_column_is_registered_in_its_own_phase_connector():
    failures = []
    for phase_name, schema_path, module_path in _PHASES:
        declared = _declared_jsonb_columns(schema_path)
        if not declared:
            continue
        module = importlib.import_module(module_path)
        registered = getattr(module, "_JSONB_COLUMNS", set())
        missing = declared - registered
        if missing:
            failures.append(f"{phase_name} ({schema_path.name}): {sorted(missing)}")

    assert not failures, (
        "Column(s) declared JSONB in schema.sql but not registered in that "
        "phase's own _JSONB_COLUMNS — any agent that writes a dict/list into "
        "these will crash with psycopg2.ProgrammingError: can't adapt type "
        "'dict'. Add them to the relevant phase's _JSONB_COLUMNS.\n"
        + "\n".join(failures)
    )
