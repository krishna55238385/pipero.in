"""Unit tests for the JSONL fallback upsert helpers.

When a phase3 table is missing, writes fall back to local JSONL. Those writes
must mirror the live PostgREST upsert (merge on the on_conflict key) — otherwise
re-running an agent piles up duplicate rows that later collide with the table's
unique index. These tests pin that behaviour.
"""
from gtm_backend.phase3.connectors import supabase


def test_fallback_upsert_merges_on_key(tmp_path, monkeypatch):
    monkeypatch.setattr(supabase, "_FALLBACK_DIR", tmp_path)

    supabase._local_fallback_upsert(
        "outreach_personalisations",
        {"lead_id": 7, "status": "ready", "quality_score": 80},
        ["lead_id"],
    )
    # same lead_id again — must REPLACE, not append
    supabase._local_fallback_upsert(
        "outreach_personalisations",
        {"lead_id": 7, "status": "low_quality", "quality_score": 40},
        ["lead_id"],
    )

    rows = supabase._local_fallback_read("outreach_personalisations")
    assert len(rows) == 1
    assert rows[0]["lead_id"] == 7
    assert rows[0]["status"] == "low_quality"   # latest write wins
    assert rows[0]["id"] == 1                    # id preserved across merge


def test_fallback_upsert_appends_distinct_keys(tmp_path, monkeypatch):
    monkeypatch.setattr(supabase, "_FALLBACK_DIR", tmp_path)

    supabase._local_fallback_upsert("outreach_sequences", {"lead_id": 1}, ["lead_id"])
    supabase._local_fallback_upsert("outreach_sequences", {"lead_id": 2}, ["lead_id"])

    rows = supabase._local_fallback_read("outreach_sequences")
    assert len(rows) == 2
    assert {r["lead_id"] for r in rows} == {1, 2}
    assert {r["id"] for r in rows} == {1, 2}


def test_fallback_upsert_many_composite_key_dedupes(tmp_path, monkeypatch):
    monkeypatch.setattr(supabase, "_FALLBACK_DIR", tmp_path)
    key = ["campaign_id", "step_number", "variant_subject"]

    supabase._local_fallback_upsert_many(
        "ab_test_results",
        [
            {"campaign_id": "c1", "step_number": 1, "variant_subject": "A", "sent_count": 10},
            {"campaign_id": "c1", "step_number": 1, "variant_subject": "A", "sent_count": 20},
            {"campaign_id": "c1", "step_number": 2, "variant_subject": "B", "sent_count": 5},
        ],
        key,
    )

    rows = supabase._local_fallback_read("ab_test_results")
    assert len(rows) == 2  # (c1,1,A) collapsed to one; (c1,2,B) separate
    a = next(r for r in rows if r["variant_subject"] == "A")
    assert a["sent_count"] == 20  # last write wins within the batch
