"""Regression tests for the Agent 08 competitor-discovery genericness fix.

Covers: seller_product_description is fetched (when the ICP has an
organization_id) and passed into the discovery LLM payload, and that
discovery still works gracefully when no organization_id or description
is available (matches pre-fix behaviour, no crash / no product context).
"""
from gtm_backend.phase2.agents.agent_08_competitive import _discover_competitor_names_llm


def test_passes_seller_product_description_when_org_id_present(mocker):
    icp = {
        "id": 1,
        "organization_id": "org-123",
        "industry": ["HR Tech"],
        "geography": ["India"],
        "buyer_titles": ["CEO"],
    }
    get_desc = mocker.patch(
        "gtm_backend.phase2.agents.agent_08_competitive.crm_supabase.get_org_product_description",
        return_value="AI-powered payroll and compliance automation for Indian SMBs.",
    )
    chat_json = mocker.patch(
        "gtm_backend.phase2.agents.agent_08_competitive.llm.chat_json",
        return_value={"competitors": ["Keka", "Zoho People", "Darwinbox"]},
    )

    names = _discover_competitor_names_llm(icp)

    get_desc.assert_called_once_with("org-123")
    payload_arg = chat_json.call_args[0][1]
    assert "AI-powered payroll and compliance automation" in payload_arg
    assert names == ["Keka", "Zoho People", "Darwinbox"]


def test_no_org_id_skips_product_description_fetch_gracefully(mocker):
    icp = {"id": 1, "industry": ["HR Tech"], "geography": ["India"], "buyer_titles": ["CEO"]}
    get_desc = mocker.patch(
        "gtm_backend.phase2.agents.agent_08_competitive.crm_supabase.get_org_product_description",
    )
    chat_json = mocker.patch(
        "gtm_backend.phase2.agents.agent_08_competitive.llm.chat_json",
        return_value={"competitors": ["Keka"]},
    )

    names = _discover_competitor_names_llm(icp)

    get_desc.assert_not_called()
    payload_arg = chat_json.call_args[0][1]
    assert '"seller_product_description": null' in payload_arg
    assert names == ["Keka"]


def test_product_description_fetch_failure_does_not_crash_discovery(mocker):
    icp = {"id": 1, "organization_id": "org-1", "industry": ["HR Tech"], "geography": ["India"], "buyer_titles": []}
    mocker.patch(
        "gtm_backend.phase2.agents.agent_08_competitive.crm_supabase.get_org_product_description",
        side_effect=RuntimeError("db down"),
    )
    chat_json = mocker.patch(
        "gtm_backend.phase2.agents.agent_08_competitive.llm.chat_json",
        return_value={"competitors": ["Keka"]},
    )

    names = _discover_competitor_names_llm(icp)

    assert names == ["Keka"]
    payload_arg = chat_json.call_args[0][1]
    assert '"seller_product_description": null' in payload_arg
