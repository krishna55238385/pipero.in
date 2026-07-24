"""Regression test for the cross-org data leak found 2026-07-25: several
phase4 read functions had no organization_id filter at all, so a board
report for one org could pull in deals belonging to a completely different
org (caught live — a report scoped to org "MT" counted a "won" deal that
actually belonged to org "Dysonc" in its conversion rate).

Fix: gtm_backend.phase3.connectors.supabase._scope_to_org(), the read-side
counterpart to the existing _inject_org() write-side tagging. These tests
exercise it directly rather than through a specific agent, since the same
helper is now shared by get_all_deals/get_active_deals/get_qualified_deals/
get_recent_revenue_forecasts/get_at_risk_pipeline_status/
get_crm_lead_by_email/get_deal_for_crm_lead/get_sent_proposals.
"""
from unittest.mock import patch

from gtm_backend.phase3.connectors import supabase


def test_adds_org_filter_when_gtm_org_id_set():
    with patch.object(supabase, "_ORG_ID", "org-123"):
        result = supabase._scope_to_org({"status": "eq.qualified"})

    assert result == {"status": "eq.qualified", "organization_id": "eq.org-123"}


def test_noop_when_gtm_org_id_unset():
    with patch.object(supabase, "_ORG_ID", None):
        result = supabase._scope_to_org({"status": "eq.qualified"})

    assert result == {"status": "eq.qualified"}
    assert "organization_id" not in result


def test_does_not_clobber_an_explicit_org_filter_already_present():
    with patch.object(supabase, "_ORG_ID", "org-123"):
        result = supabase._scope_to_org({"organization_id": "eq.org-456"})

    assert result["organization_id"] == "eq.org-456"


def test_does_not_mutate_the_input_dict():
    original = {"status": "eq.qualified"}
    with patch.object(supabase, "_ORG_ID", "org-123"):
        supabase._scope_to_org(original)

    assert "organization_id" not in original
