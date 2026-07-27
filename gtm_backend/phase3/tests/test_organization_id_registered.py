"""Regression guard for a recurring bug class: _inject_org() (in each phase's
connectors/supabase.py) unconditionally tags EVERY _post()/_upsert() insert
with organization_id whenever GTM_ORG_ID is set — there is no per-table
opt-out. Any table written via _post/_upsert that lacks an organization_id
column in its actual Postgres schema crashes live with
psycopg2.errors.UndefinedColumn the first time a real insert happens, but
every existing unit test mocks the connector, so nothing catches the gap
until it's hit in production.

This has happened 3 times so far (data_quality_reports, nurture_touches, and
a latent not-yet-triggered case on leads_raw) — each time found live on EC2,
never by the test suite. This test root-causes it: for every table name that
appears as a literal "/table_name" argument to _post(...) or _upsert(...) in
a phase's connector module, check that same phase's schema.sql declares an
organization_id column for that table (via CREATE TABLE or a later ALTER
TABLE ... ADD COLUMN).

If this test fails, the fix is almost always: add
    ALTER TABLE <table> ADD COLUMN IF NOT EXISTS organization_id UUID;
to that phase's schema.sql, immediately after the table's CREATE TABLE block.
"""
import re
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent

_PHASES = [
    ("phase1", _REPO_ROOT / "phase1" / "data" / "schema.sql", _REPO_ROOT / "phase1" / "connectors" / "supabase.py"),
    ("phase2", _REPO_ROOT / "phase2" / "data" / "schema.sql", _REPO_ROOT / "phase2" / "connectors" / "supabase.py"),
    ("phase3", _REPO_ROOT / "phase3" / "data" / "schema.sql", _REPO_ROOT / "phase3" / "connectors" / "supabase.py"),
]

_WRITE_CALL = re.compile(r'_(?:post|upsert)\(\s*"/([a-z_]+)"')


def _written_tables(connector_path: Path) -> set[str]:
    if not connector_path.exists():
        return set()
    text = connector_path.read_text(encoding="utf-8")
    if "_inject_org" not in text:
        # This phase's connector doesn't tag inserts with organization_id at
        # all, so the bug class doesn't apply to it.
        return set()
    return set(_WRITE_CALL.findall(text))


# Tables that are owned by the Next.js CRM app (created via its own
# migrations, not gtm_backend's schema.sql) — e.g. "deals". These are out of
# scope for this test: the CRM's own schema already enforces organization_id
# tenancy on them, and gtm_backend only ever UPDATEs/reads them by id, never
# _post()s a brand-new row, so _inject_org never applies in practice even
# though the table name appears as a _post()/_upsert() argument in a comment
# or an update-only helper.
_CRM_OWNED_TABLES = {"deals"}


def _table_has_organization_id(schema_text: str, table: str) -> bool:
    # CREATE TABLE <table> ( ... ) — look inside the parenthesised block up
    # to the closing ");" that ends the statement.
    create_match = re.search(
        rf"CREATE TABLE(?:\s+IF NOT EXISTS)?\s+{re.escape(table)}\s*\((.*?)\n\);",
        schema_text,
        re.DOTALL,
    )
    if create_match and "organization_id" in create_match.group(1):
        return True

    # ALTER TABLE <table> ADD COLUMN IF NOT EXISTS organization_id ...
    alter_pattern = re.compile(
        rf"ALTER TABLE\s+{re.escape(table)}\s+ADD COLUMN(?:\s+IF NOT EXISTS)?\s+organization_id\b"
    )
    return bool(alter_pattern.search(schema_text))


def test_every_written_table_has_organization_id_in_its_own_phase_schema():
    # A handful of physical tables (e.g. llm_usage) are written to by more
    # than one phase's connector but only declared with CREATE TABLE in ONE
    # phase's schema.sql (the others just ALTER/insert into the same shared
    # table). So a table only needs organization_id declared in ANY phase's
    # schema.sql, not necessarily its own — check the union of all schemas.
    all_schema_text = "\n".join(
        p.read_text(encoding="utf-8") for _, p, _ in _PHASES if p.exists()
    )

    failures = []
    for phase_name, schema_path, connector_path in _PHASES:
        tables = _written_tables(connector_path)
        if not tables:
            continue
        missing = sorted(
            t for t in tables
            if t not in _CRM_OWNED_TABLES and not _table_has_organization_id(all_schema_text, t)
        )
        if missing:
            failures.append(f"{phase_name} ({connector_path.name}): {missing}")

    assert not failures, (
        "Table(s) written via _post()/_upsert() in a phase whose connector "
        "unconditionally tags inserts with organization_id (_inject_org), but "
        "with no organization_id column declared in that phase's schema.sql. "
        "The first real insert will crash with psycopg2.errors.UndefinedColumn. "
        "Add 'ALTER TABLE <table> ADD COLUMN IF NOT EXISTS organization_id UUID;' "
        "to the relevant phase's schema.sql.\n" + "\n".join(failures)
    )
