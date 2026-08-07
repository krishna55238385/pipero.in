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

    p_propose_meetings = sub.add_parser(
        "propose-meetings",
        help="Agent 22: check 'interested' replies for meeting intent, email >=3 Cal.com slots for each",
    )
    p_propose_meetings.add_argument("--limit", type=int, default=None)

    p_sync_meetings = sub.add_parser(
        "sync-meeting-confirmations",
        help="Agent 22: check proposed meetings for a confirming reply and book it with Cal.com",
    )
    p_sync_meetings.add_argument("--limit", type=int, default=None)

    p_briefs = sub.add_parser(
        "generate-meeting-briefs",
        help="Agent 23: generate a one-page pre-meeting brief for every confirmed meeting that doesn't have one",
    )
    p_briefs.add_argument("--limit", type=int, default=None)

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

    p_nurture = sub.add_parser(
        "run-nurture",
        help="Agent 40: advance the lead nurture programme (draft touches, detect signals, enforce cadence)",
    )
    p_nurture.add_argument("--limit", type=int, default=None)

    p_reengage = sub.add_parser(
        "run-reengagement",
        help="Agent 41: draft re-engagement outreach for lost deals past their cooldown window",
    )
    p_reengage.add_argument("--limit", type=int, default=None)

    p_champion = sub.add_parser(
        "track-champions",
        help="Agent 42: check won-deal contacts for job changes, draft warm re-connects (skips competitors)",
    )
    p_champion.add_argument("--limit", type=int, default=None)

    p_expansion = sub.add_parser(
        "find-expansion-opportunities",
        help="Agent 43: identify upsell/expansion angles for onboarded won deals past a 60-day cooldown",
    )
    p_expansion.add_argument("--limit", type=int, default=None)

    p_referral = sub.add_parser(
        "run-referral",
        help="Agent 44: draft specific referral asks for onboarded won deals past a 60-day cooldown",
    )
    p_referral.add_argument("--limit", type=int, default=None)

    sub.add_parser(
        "generate-revenue-intelligence",
        help="Agent 45: analyse win/loss patterns across closed deals (needs 20+ closed deals for insights)",
    )

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
    elif command == "propose-meetings":
        from gtm_backend.phase4.agents.agent_22_meeting_booking import propose_meetings
        propose_meetings(args.limit)
    elif command == "sync-meeting-confirmations":
        from gtm_backend.phase4.agents.agent_22_meeting_booking import sync_meeting_confirmations
        sync_meeting_confirmations(args.limit)
    elif command == "generate-meeting-briefs":
        from gtm_backend.phase4.agents.agent_23_pre_meeting_brief import generate_pending_meeting_briefs
        generate_pending_meeting_briefs(args.limit)
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
    elif command == "run-nurture":
        from gtm_backend.phase4.agents.agent_40_lead_nurturing import run_lead_nurturing
        run_lead_nurturing(args.limit)
    elif command == "run-reengagement":
        from gtm_backend.phase4.agents.agent_41_reengagement import run_reengagement
        run_reengagement(args.limit)
    elif command == "track-champions":
        from gtm_backend.phase4.agents.agent_42_champion_tracker import run_champion_tracker
        run_champion_tracker(args.limit)
    elif command == "find-expansion-opportunities":
        from gtm_backend.phase4.agents.agent_43_expansion_upsell import run_expansion_upsell
        run_expansion_upsell(args.limit)
    elif command == "run-referral":
        from gtm_backend.phase4.agents.agent_44_referral import run_referral
        run_referral(args.limit)
    elif command == "generate-revenue-intelligence":
        from gtm_backend.phase4.agents.agent_45_revenue_intelligence import generate_revenue_intelligence
        generate_revenue_intelligence()
    return 0


if __name__ == "__main__":
    sys.exit(main())
