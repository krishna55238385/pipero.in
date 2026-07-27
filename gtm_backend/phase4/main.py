"""Phase 4 CLI. Run: `python -m phase4 <command> [options]`."""
import argparse
import sys


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="phase4", description="AI GTM Agency — Phase 4 pipeline (CONVERT + MANAGE & REPORT)")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser(
        "sync-crm",
        help="Agent 32: audit CRM for duplicate contacts, unverifiable contacts, and stale deals (flags only, never merges/deletes)",
    )

    p_qualify = sub.add_parser(
        "qualify-deals",
        help="Agent 24: score 'interested' replies and create/update CRM deals",
    )
    p_qualify.add_argument("--limit", type=int, default=None)

    p_propose = sub.add_parser(
        "generate-proposals",
        help="Agent 25: draft a proposal for every qualified deal that doesn't have one",
    )
    p_propose.add_argument("--limit", type=int, default=None)

    p_followup = sub.add_parser(
        "check-proposal-followups",
        help="Agent 26: evaluate sent proposals and draft due follow-ups / seller alerts",
    )
    p_followup.add_argument("--limit", type=int, default=None)

    p_exec = sub.add_parser(
        "generate-executive-briefs",
        help="Agent 27: draft an executive brief for qualified deals with an engaged champion signal",
    )
    p_exec.add_argument("--limit", type=int, default=None)

    p_pipeline = sub.add_parser(
        "review-pipeline",
        help="Agent 33: flag at-risk/stuck deals and assign a specific next-best-action to every active deal",
    )
    p_pipeline.add_argument("--limit", type=int, default=None)

    sub.add_parser(
        "generate-forecast",
        help="Agent 34: roll up active deals into a conservative/base/optimistic revenue forecast snapshot",
    )

    sub.add_parser(
        "generate-board-report",
        help="Agent 35: compile pipeline/forecast/risk data into a leadership-ready board report",
    )

    sub.add_parser(
        "generate-roi-report",
        help="Agent 36: compute cost-per-lead/qualified-deal/closed-deal and flag negative ROI",
    )

    p_refresh = sub.add_parser(
        "refresh-data",
        help="Agent 37: re-verify stale/bounced leads, compute data quality scores, log a health snapshot",
    )
    p_refresh.add_argument("--limit", type=int, default=None)

    p_inbound = sub.add_parser(
        "capture-inbound-signals",
        help="Agent 38: promote multi-session website visitor signals into leads (2+ sessions, ICP-aware)",
    )
    p_inbound.add_argument("--limit", type=int, default=None)

    p_handoff = sub.add_parser(
        "generate-handoffs",
        help="Agent 39: draft an onboarding handoff brief for every won deal that doesn't have one",
    )
    p_handoff.add_argument("--limit", type=int, default=None)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    command = args.command

    if command == "sync-crm":
        from gtm_backend.phase4.agents.agent_32_crm_sync import run_crm_sync
        run_crm_sync()
    elif command == "qualify-deals":
        from gtm_backend.phase4.agents.agent_24_deal_qualification import qualify_pending_deals
        qualify_pending_deals(args.limit)
    elif command == "generate-proposals":
        from gtm_backend.phase4.agents.agent_25_proposal_generation import generate_pending_proposals
        generate_pending_proposals(args.limit)
    elif command == "check-proposal-followups":
        from gtm_backend.phase4.agents.agent_26_proposal_followup import check_proposal_followups
        check_proposal_followups(args.limit)
    elif command == "generate-executive-briefs":
        from gtm_backend.phase4.agents.agent_27_executive_engagement import generate_pending_executive_briefs
        generate_pending_executive_briefs(args.limit)
    elif command == "review-pipeline":
        from gtm_backend.phase4.agents.agent_33_pipeline_management import run_pipeline_review
        run_pipeline_review(args.limit)
    elif command == "generate-forecast":
        from gtm_backend.phase4.agents.agent_34_revenue_forecasting import generate_revenue_forecast
        generate_revenue_forecast()
    elif command == "generate-board-report":
        from gtm_backend.phase4.agents.agent_35_board_reporting import generate_board_report
        generate_board_report()
    elif command == "generate-roi-report":
        from gtm_backend.phase4.agents.agent_36_roi_attribution import generate_roi_attribution
        generate_roi_attribution()
    elif command == "refresh-data":
        from gtm_backend.phase4.agents.agent_37_data_refresh import run_data_refresh
        run_data_refresh(args.limit)
    elif command == "capture-inbound-signals":
        from gtm_backend.phase4.agents.agent_38_inbound_signal_capture import run_inbound_signal_capture
        run_inbound_signal_capture(args.limit)
    elif command == "generate-handoffs":
        from gtm_backend.phase4.agents.agent_39_onboarding_handoff import generate_pending_handoffs
        generate_pending_handoffs(args.limit)
    return 0


if __name__ == "__main__":
    sys.exit(main())
