"""Phase 4 CLI. Run: `python -m phase4 <command> [options]`."""
import argparse
import sys


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="phase4", description="AI GTM Agency — Phase 4 pipeline (CONVERT)")
    sub = parser.add_subparsers(dest="command", required=True)

    p_qualify = sub.add_parser(
        "qualify-deals",
        help="Agent 24: score 'interested' replies and create/update CRM deals",
    )
    p_qualify.add_argument("--limit", type=int, default=None)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    command = args.command

    if command == "qualify-deals":
        from gtm_backend.phase4.agents.agent_24_deal_qualification import qualify_pending_deals
        qualify_pending_deals(args.limit)
    return 0


if __name__ == "__main__":
    sys.exit(main())
