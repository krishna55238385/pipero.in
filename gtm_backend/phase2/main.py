"""Phase 2 CLI. Run: `python -m phase2 <command> [options]`."""
import argparse
import sys
import time
from pathlib import Path

from gtm_backend.phase2.agents.agent_06_account_intel import build_account_intelligence
from gtm_backend.phase2.agents.agent_07_stakeholders import map_stakeholders
from gtm_backend.phase2.agents.agent_08_competitive import gather_competitive_intel
from gtm_backend.phase2.agents.agent_09_market_sizing import size_markets
from gtm_backend.phase2.agents.agent_10_gtm_insights import approve_insights, generate_insights

_SCHEMA_PATH = Path(__file__).resolve().parent / "data" / "schema.sql"


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="phase2", description="AI GTM Agency — Phase 2 pipeline (UNDERSTAND)")
    sub = parser.add_subparsers(dest="command", required=True)

    p_intel = sub.add_parser("account-intel", help="Agent 06: build account intelligence briefs")
    p_intel.add_argument("--icp", type=int, default=None, dest="icp_id")
    p_intel.add_argument("--limit", type=int, default=None)

    p_smap = sub.add_parser("stakeholders", help="Agent 07: map the buying committee per account")
    p_smap.add_argument("--icp", type=int, default=None, dest="icp_id")
    p_smap.add_argument("--limit", type=int, default=None)

    p_comp = sub.add_parser("competitive", help="Agent 08: gather competitive intelligence per ICP")
    p_comp.add_argument("--icp", type=int, default=None, dest="icp_id")
    p_comp.add_argument("--max", type=int, default=5, dest="max_competitors")

    p_market = sub.add_parser("market-sizing", help="Agent 09: produce this week's ranked market map")
    p_market.add_argument("--force", action="store_true", help="recompute even if this week's snapshot already exists")

    p_gtm = sub.add_parser("gtm-insights", help="Agent 10: synthesise per-account GTM briefs")
    p_gtm.add_argument("--icp", type=int, default=None, dest="icp_id")
    p_gtm.add_argument("--limit", type=int, default=None)

    p_appr = sub.add_parser(
        "approve-insights",
        help="Agent 10: human-review gate — approve pending GTM briefs",
    )
    p_appr.add_argument("--lead", type=int, default=None, dest="lead_id",
                        help="approve one lead's brief(s); omit with --all for every pending")
    p_appr.add_argument("--icp", type=int, default=None, dest="icp_id")
    p_appr.add_argument("--all", action="store_true", dest="approve_all",
                        help="approve every pending brief (optionally scoped by --icp)")
    p_appr.add_argument("--by", type=str, default="human", dest="reviewed_by")

    p_all = sub.add_parser("run-all", help="Chain 06 → 07 → 08 → 09 → 10")
    p_all.add_argument("--icp", type=int, default=None, dest="icp_id")
    p_all.add_argument("--limit", type=int, default=None)
    p_all.add_argument("--max-competitors", type=int, default=5, dest="max_competitors")

    sub.add_parser(
        "print-schema",
        help="Print phase2/data/schema.sql for one-shot apply in Supabase SQL editor",
    )

    return parser


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    command = args.command

    if command == "account-intel":
        build_account_intelligence(args.icp_id, args.limit)
    elif command == "stakeholders":
        map_stakeholders(args.icp_id, args.limit)
    elif command == "competitive":
        gather_competitive_intel(args.icp_id, args.max_competitors)
    elif command == "market-sizing":
        size_markets(force=args.force)
    elif command == "gtm-insights":
        generate_insights(args.icp_id, args.limit)
    elif command == "approve-insights":
        if args.lead_id is None and not args.approve_all:
            print("  ⚠ specify --lead <id> or --all (optionally with --icp)")
            return 2
        approve_insights(
            lead_id=args.lead_id, icp_id=args.icp_id, reviewed_by=args.reviewed_by,
        )
    elif command == "run-all":
        start = time.perf_counter()
        build_account_intelligence(args.icp_id, args.limit)
        map_stakeholders(args.icp_id, args.limit)
        gather_competitive_intel(args.icp_id, args.max_competitors)
        size_markets()
        generate_insights(args.icp_id, args.limit)
        elapsed = time.perf_counter() - start
        bar = "═" * 72
        print(f"\n{bar}")
        print(f"  ✓ PHASE 2 PIPELINE COMPLETE — elapsed {elapsed:.1f}s")
        print(bar)
    elif command == "print-schema":
        sys.stdout.write(_SCHEMA_PATH.read_text())
    return 0


if __name__ == "__main__":
    sys.exit(main())
