"""Phase 1 CLI. Run: `python -m phase1 <command> [options]`."""
import argparse
import sys
import time
from pathlib import Path

from gtm_backend.phase1.agents.agent_01_icp import define_icp
from gtm_backend.phase1.agents.agent_02_leads import generate_leads
from gtm_backend.phase1.agents.agent_03_enrichment import enrich_leads
from gtm_backend.phase1.agents.agent_04_signals import detect_signals
from gtm_backend.phase1.agents.agent_05_scoring import score_leads
from gtm_backend.phase1.connectors import supabase

_SCHEMA_PATH = Path(__file__).resolve().parent / "data" / "schema.sql"


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="phase1", description="AI GTM Agency — Phase 1 pipeline")
    sub = parser.add_subparsers(dest="command", required=True)

    p_icp = sub.add_parser("icp", help="Agent 01: define a new ICP from prompt")
    p_icp.add_argument("prompt", type=str)

    p_leads = sub.add_parser("leads", help="Agent 02: generate company records for an ICP")
    p_leads.add_argument("--icp", type=int, required=True, dest="icp_id")
    p_leads.add_argument("--max", type=int, default=20, dest="max_leads")

    p_enrich = sub.add_parser("enrich", help="Agent 03: enrich leads with contact + verified email")
    p_enrich.add_argument("--icp", type=int, default=None, dest="icp_id")
    p_enrich.add_argument("--limit", type=int, default=50)

    p_sig = sub.add_parser(
        "signals",
        help="Agent 04: detect buying signals (--icp optional; omit to refresh ALL leads org-wide)",
    )
    p_sig.add_argument("--icp", type=int, default=None, dest="icp_id")
    p_sig.add_argument("--days", type=int, default=90, dest="lookback_days")
    p_sig.add_argument("--limit", type=int, default=50)

    p_score = sub.add_parser("score", help="Agent 05: score leads")
    p_score.add_argument("--mode", choices=["unscored", "icp_id", "lead_id"], default="unscored")
    p_score.add_argument("--icp", type=int, default=None, dest="icp_id")
    p_score.add_argument("--lead-id", type=int, default=None, dest="lead_id")
    p_score.add_argument("--limit", type=int, default=500)

    p_all = sub.add_parser("run-all", help="Chain 01 → 02 → 03 → 04 → 05")
    p_all.add_argument("--prompt", type=str, required=True)
    p_all.add_argument("--max", type=int, default=20, dest="max_leads")

    sub.add_parser("print-schema", help="Print phase1/data/schema.sql for one-shot apply in Supabase SQL editor")

    return parser


def _print_buying_intent_summary(icp_id: int) -> None:
    leads = supabase.get_leads_for_scoring(mode="icp_id", icp_id=icp_id)
    if not leads:
        print(f"\n[run-all] No scored leads found for ICP #{icp_id}.")
        return

    lead_ids = [lead["id"] for lead in leads]
    signals_by_lead = supabase.get_signals_for_leads(lead_ids)

    W_NAME, W_SCORE, W_TIER, W_SIGS, W_INTENT = 28, 8, 8, 9, 22
    bar = "═" * (W_NAME + W_SCORE + W_TIER + W_SIGS + W_INTENT + 4)
    divider = "─" * (W_NAME + W_SCORE + W_TIER + W_SIGS + W_INTENT + 4)

    print(f"\n{bar}")
    print(f"  PIPELINE COMPLETE — ICP #{icp_id}")
    print(bar)
    header = (
        f"  {'Lead':<{W_NAME}}{'Score':<{W_SCORE}}{'Tier':<{W_TIER}}"
        f"{'Signals':<{W_SIGS}}{'Top Intent':<{W_INTENT}}"
    )
    print(header)
    print(f"  {divider}")

    for lead in leads:
        name = (lead.get("company_name") or "Unknown")[:W_NAME - 1]
        score = lead.get("icp_score")
        score_str = f"{score}/100" if score is not None else "—"
        tier = (lead.get("score_tier") or "—").upper()
        lead_signals = signals_by_lead.get(lead["id"], [])
        non_na = [s for s in lead_signals if s.get("signal_type", "na") != "na"]
        sig_count = len(non_na)

        high_intent_signals = [s for s in non_na if s.get("buying_intent") == "high"]
        if high_intent_signals:
            top = high_intent_signals[0]
            top_intent = f"{top.get('signal_type', 'unknown')} (high)"
        else:
            top_intent = "none"

        print(
            f"  {name:<{W_NAME}}{score_str:<{W_SCORE}}{tier:<{W_TIER}}"
            f"{sig_count:<{W_SIGS}}{top_intent:<{W_INTENT}}"
        )

    print(bar)


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    command = args.command

    if command == "icp":
        define_icp(args.prompt)
    elif command == "leads":
        generate_leads(args.icp_id, args.max_leads)
    elif command == "enrich":
        enrich_leads(args.icp_id, args.limit)
    elif command == "signals":
        detect_signals(args.icp_id, args.lookback_days, args.limit)
    elif command == "score":
        score_leads(args.mode, args.lead_id, args.icp_id, args.limit)
    elif command == "run-all":
        start = time.perf_counter()
        icp_id = define_icp(args.prompt)
        generate_leads(icp_id, args.max_leads)
        enrich_leads(icp_id)
        detect_signals(icp_id)
        score_leads(mode="icp_id", icp_id=icp_id)
        _print_buying_intent_summary(icp_id)
        elapsed = time.perf_counter() - start
        bar = "═" * 72
        print(f"\n{bar}")
        print(f"  ✓ PIPELINE COMPLETE — ICP #{icp_id} · elapsed {elapsed:.1f}s")
        print(bar)
    elif command == "print-schema":
        sys.stdout.write(_SCHEMA_PATH.read_text())
    return 0


if __name__ == "__main__":
    sys.exit(main())
