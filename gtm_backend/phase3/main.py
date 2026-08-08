"""Phase 3 CLI. Run: `python -m phase3 <command> [options]`.

Agent imports are LAZY (inside each command branch) so the foundation
modules can be imported and the schema can be printed even before the
agent files exist.
"""
import argparse
import sys
import time
from pathlib import Path


_SCHEMA_PATH = Path(__file__).resolve().parent / "data" / "schema.sql"


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="phase3", description="AI GTM Agency — Phase 3 pipeline (REACH)")
    sub = parser.add_subparsers(dest="command", required=True)

    p_pers = sub.add_parser("personalise", help="Agent 11: generate personalisation angles per lead")
    p_pers.add_argument("--icp", type=int, default=None, dest="icp_id")
    p_pers.add_argument("--limit", type=int, default=None)

    p_copy = sub.add_parser("copywrite", help="Agent 12: write 5-step sequence with 2 variants per step")
    p_copy.add_argument("--icp", type=int, default=None, dest="icp_id")
    p_copy.add_argument("--limit", type=int, default=None)

    p_chan = sub.add_parser("channel-strategy", help="Agent 13: choose channels, send window, cadence")
    p_chan.add_argument("--icp", type=int, default=None, dest="icp_id")
    p_chan.add_argument("--limit", type=int, default=None)

    p_orch = sub.add_parser("orchestrate", help="Agent 14: send outreach (Instantly campaign or direct Gmail)")
    p_orch.add_argument("--icp", type=int, default=None, dest="icp_id")
    p_orch.add_argument("--limit", type=int, default=None)
    p_orch.add_argument("--dry-run", action="store_true", dest="dry_run")
    p_orch.add_argument(
        "--sender", choices=["instantly", "gmail"], default="instantly",
        help="instantly = hand off to Instantly campaign; gmail = send directly over Gmail SMTP",
    )
    p_orch.add_argument(
        "--campaign-id", type=str, default=None, dest="campaign_id",
        help="CRM campaign id to stamp on every outreach_log row (overrides the "
             "auto-generated 'gmail-icp-...'/Instantly id for this run)",
    )

    p_ab = sub.add_parser("ab-test", help="Agent 15: score variants from Instantly analytics")
    p_ab.add_argument("--campaign-id", type=str, default=None, dest="campaign_id")

    p_follow = sub.add_parser(
        "followups", help="Agent 19: advance leads to the next due sequence step (steps 2..N)"
    )
    p_follow.add_argument("--icp", type=int, default=None, dest="icp_id")
    p_follow.add_argument("--limit", type=int, default=None)
    p_follow.add_argument("--dry-run", action="store_true", dest="dry_run")

    p_inbox = sub.add_parser(
        "classify-reply",
        help="Agent 16: classify one reply (manual/testing entrypoint — real integration calls classify_reply() directly)",
    )
    p_inbox.add_argument("--from", type=str, required=True, dest="from_email")
    p_inbox.add_argument("--text", type=str, required=True, dest="reply_text")
    p_inbox.add_argument("--campaign-id", type=str, default="", dest="campaign_id")

    p_poll = sub.add_parser(
        "poll-inbox",
        help="Agent 16: poll the connected Gmail inbox for real replies and classify them (Task #35)",
    )
    p_poll.add_argument("--days-back", type=int, default=3, dest="days_back")
    p_poll.add_argument("--max-results", type=int, default=25, dest="max_results")

    p_draft = sub.add_parser("draft-replies", help="Agent 17: draft responses for classified replies awaiting one")
    p_draft.add_argument("--limit", type=int, default=None)

    p_send_reply = sub.add_parser(
        "send-reply", help="Agent 17: send a human-approved draft (response_status must be 'approved')"
    )
    p_send_reply.add_argument("--reply-id", type=int, required=True, dest="reply_id")

    p_objections = sub.add_parser(
        "detect-objections",
        help="Agent 18: detect objection type + rebuttal angle for not_now/has_question replies (run before draft-replies)",
    )
    p_objections.add_argument("--limit", type=int, default=None)

    p_all = sub.add_parser("run-all", help="Chain 11 → 12 → 13 → 14 (15 skipped — needs live data)")
    p_all.add_argument("--icp", type=int, default=None, dest="icp_id")
    p_all.add_argument("--limit", type=int, default=None)
    p_all.add_argument("--dry-run", action="store_true", dest="dry_run")
    p_all.add_argument(
        "--sender", choices=["instantly", "gmail"], default="instantly",
        help="Agent 14 send mode: instantly (default) or gmail (direct SMTP)",
    )
    p_all.add_argument(
        "--campaign-id", type=str, default=None, dest="campaign_id",
        help="CRM campaign id to stamp on every outreach_log row (overrides the "
             "auto-generated 'gmail-icp-...'/Instantly id for this run)",
    )

    sub.add_parser(
        "print-schema",
        help="Print phase3/data/schema.sql for one-shot apply in Supabase SQL editor",
    )

    return parser


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    command = args.command

    if command == "personalise":
        from gtm_backend.phase3.agents.agent_11_personalisation import run_personalisation
        run_personalisation(args.icp_id, args.limit)
    elif command == "copywrite":
        from gtm_backend.phase3.agents.agent_12_copywriter import run_copywriting
        run_copywriting(args.icp_id, args.limit)
    elif command == "channel-strategy":
        from gtm_backend.phase3.agents.agent_13_channel_strategy import run_channel_strategy
        run_channel_strategy(args.icp_id, args.limit)
    elif command == "orchestrate":
        if args.sender == "gmail":
            from gtm_backend.phase3.agents.agent_14_orchestrator import run_gmail_orchestration
            run_gmail_orchestration(
                args.icp_id, args.limit, args.dry_run, campaign_id=args.campaign_id
            )
        else:
            from gtm_backend.phase3.agents.agent_14_orchestrator import run_orchestration
            run_orchestration(
                args.icp_id, args.limit, args.dry_run, campaign_id=args.campaign_id
            )
    elif command == "ab-test":
        from gtm_backend.phase3.agents.agent_15_ab_testing import run_ab_testing
        run_ab_testing(args.campaign_id)
    elif command == "followups":
        from gtm_backend.phase3.agents.agent_19_followup import run_followups
        run_followups(args.icp_id, args.limit, args.dry_run)
    elif command == "classify-reply":
        from gtm_backend.phase3.agents.agent_16_inbox import classify_reply
        classify_reply(args.from_email, args.reply_text, args.campaign_id)
    elif command == "poll-inbox":
        from gtm_backend.phase3.agents.agent_16_inbox import poll_and_classify_inbox
        poll_and_classify_inbox(args.days_back, args.max_results)
    elif command == "draft-replies":
        from gtm_backend.phase3.agents.agent_17_reply_handling import draft_pending_responses
        draft_pending_responses(args.limit)
    elif command == "send-reply":
        from gtm_backend.phase3.agents.agent_17_reply_handling import send_approved_response
        send_approved_response(args.reply_id)
    elif command == "detect-objections":
        from gtm_backend.phase3.agents.agent_18_objection_handling import detect_pending_objections
        detect_pending_objections(args.limit)
    elif command == "run-all":
        from gtm_backend.phase3.agents.agent_11_personalisation import run_personalisation
        from gtm_backend.phase3.agents.agent_12_copywriter import run_copywriting
        from gtm_backend.phase3.agents.agent_13_channel_strategy import run_channel_strategy
        from gtm_backend.phase3.agents.agent_14_orchestrator import (
            run_gmail_orchestration,
            run_orchestration,
        )
        start = time.perf_counter()
        run_personalisation(args.icp_id, args.limit)
        run_copywriting(args.icp_id, args.limit)
        run_channel_strategy(args.icp_id, args.limit)
        if args.sender == "gmail":
            run_gmail_orchestration(
                args.icp_id, args.limit, args.dry_run, campaign_id=args.campaign_id
            )
        else:
            run_orchestration(
                args.icp_id, args.limit, args.dry_run, campaign_id=args.campaign_id
            )
        elapsed = time.perf_counter() - start
        bar = "═" * 72
        print(f"\n{bar}")
        print(f"  ✓ PHASE 3 PIPELINE COMPLETE — elapsed {elapsed:.1f}s")
        print(f"  (Agent 15 skipped — run `python -m phase3 ab-test` once live data exists)")
        print(bar)
    elif command == "print-schema":
        sys.stdout.write(_SCHEMA_PATH.read_text())
    return 0


if __name__ == "__main__":
    sys.exit(main())
