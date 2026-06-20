"""Unified GTM backend CLI — feature-named, one entrypoint.

Run::

    python -m gtm_backend <feature> [options]

Features map 1:1 to the modules in this package (which wrap the existing
phaseN agents). Grouped by pipeline stage:

  FIND        find · enrich · signals · score
  UNDERSTAND  account-intel · stakeholders · competitive · market-sizing
              · gtm-brief · approve-brief
  REACH       personalize · copywrite · channel · send · ab-test

Convenience chains (same order the phaseN ``run-all`` commands use):

  find-all       define ICP from --prompt → enrich → signals → score
  understand-all  account-intel → stakeholders → competitive → market-sizing
                  → gtm-brief
  reach-all      personalize → copywrite → channel → send

This CLI is a thin dispatcher; behaviour is identical to the underlying
``python -m gtm_backend.phaseN ...`` commands.
"""
from __future__ import annotations

import argparse
import sys
import time

from gtm_backend import (
    ab_testing,
    account_intel,
    channel,
    competitive,
    copywriter,
    enrich,
    find_leads,
    gtm_brief,
    market_sizing,
    personalize,
    score,
    send,
    signals,
    stakeholders,
)


def _bar(msg: str) -> None:
    line = "═" * 72
    print(f"\n{line}\n  {msg}\n{line}")


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="gtm_backend",
        description="pipero GTM product backend — unified, feature-named CLI",
    )
    sub = parser.add_subparsers(dest="feature", required=True)

    # ---- FIND ----------------------------------------------------------- #
    p_find = sub.add_parser("find", help="define an ICP from a prompt + generate leads")
    p_find.add_argument("--prompt", type=str, required=True)
    p_find.add_argument("--max", type=int, default=20, dest="max_leads")

    p_icp = sub.add_parser("icp", help="define a new ICP from a prompt (returns id)")
    p_icp.add_argument("prompt", type=str)

    p_leads = sub.add_parser("leads", help="generate company leads for an existing ICP")
    p_leads.add_argument("--icp", type=int, required=True, dest="icp_id")
    p_leads.add_argument("--max", type=int, default=20, dest="max_leads")

    p_enrich = sub.add_parser("enrich", help="add contacts + verified/pattern emails")
    p_enrich.add_argument("--icp", type=int, default=None, dest="icp_id")
    p_enrich.add_argument("--limit", type=int, default=50)

    p_sig = sub.add_parser("signals", help="detect buying signals")
    p_sig.add_argument("--icp", type=int, default=None, dest="icp_id")
    p_sig.add_argument("--days", type=int, default=90, dest="lookback_days")
    p_sig.add_argument("--limit", type=int, default=50)

    p_score = sub.add_parser("score", help="score leads against the ICP rubric")
    p_score.add_argument("--mode", choices=["unscored", "icp_id", "lead_id"], default="unscored")
    p_score.add_argument("--icp", type=int, default=None, dest="icp_id")
    p_score.add_argument("--lead-id", type=int, default=None, dest="lead_id")
    p_score.add_argument("--limit", type=int, default=500)

    p_find_all = sub.add_parser("find-all", help="ICP → leads → enrich → signals → score")
    p_find_all.add_argument("--prompt", type=str, required=True)
    p_find_all.add_argument("--max", type=int, default=20, dest="max_leads")

    # ---- UNDERSTAND ----------------------------------------------------- #
    p_intel = sub.add_parser("account-intel", help="build per-account intelligence briefs")
    p_intel.add_argument("--icp", type=int, default=None, dest="icp_id")
    p_intel.add_argument("--limit", type=int, default=None)

    p_stake = sub.add_parser("stakeholders", help="map the buying committee per account")
    p_stake.add_argument("--icp", type=int, default=None, dest="icp_id")
    p_stake.add_argument("--limit", type=int, default=None)

    p_comp = sub.add_parser("competitive", help="gather competitive intelligence per ICP")
    p_comp.add_argument("--icp", type=int, default=None, dest="icp_id")
    p_comp.add_argument("--max", type=int, default=5, dest="max_competitors")

    sub.add_parser("market-sizing", help="produce this week's ranked market map")

    p_brief = sub.add_parser("gtm-brief", help="synthesise per-account GTM briefs")
    p_brief.add_argument("--icp", type=int, default=None, dest="icp_id")
    p_brief.add_argument("--limit", type=int, default=None)

    p_appr = sub.add_parser("approve-brief", help="human-review gate: approve pending GTM briefs")
    p_appr.add_argument("--lead", type=int, default=None, dest="lead_id")
    p_appr.add_argument("--icp", type=int, default=None, dest="icp_id")
    p_appr.add_argument("--all", action="store_true", dest="approve_all")
    p_appr.add_argument("--by", type=str, default="human", dest="reviewed_by")

    p_und_all = sub.add_parser(
        "understand-all",
        help="account-intel → stakeholders → competitive → market-sizing → gtm-brief",
    )
    p_und_all.add_argument("--icp", type=int, default=None, dest="icp_id")
    p_und_all.add_argument("--limit", type=int, default=None)
    p_und_all.add_argument("--max-competitors", type=int, default=5, dest="max_competitors")

    # ---- REACH ---------------------------------------------------------- #
    p_pers = sub.add_parser("personalize", help="generate per-lead personalisation angles")
    p_pers.add_argument("--icp", type=int, default=None, dest="icp_id")
    p_pers.add_argument("--limit", type=int, default=None)

    p_copy = sub.add_parser("copywrite", help="write the 5-step outreach sequence")
    p_copy.add_argument("--icp", type=int, default=None, dest="icp_id")
    p_copy.add_argument("--limit", type=int, default=None)

    p_chan = sub.add_parser("channel", help="choose channels, send window, cadence")
    p_chan.add_argument("--icp", type=int, default=None, dest="icp_id")
    p_chan.add_argument("--limit", type=int, default=None)

    p_send = sub.add_parser("send", help="dispatch outreach (Instantly or direct Gmail)")
    p_send.add_argument("--icp", type=int, default=None, dest="icp_id")
    p_send.add_argument("--limit", type=int, default=None)
    p_send.add_argument("--dry-run", action="store_true", dest="dry_run")
    p_send.add_argument("--sender", choices=["instantly", "gmail"], default="instantly")

    p_ab = sub.add_parser("ab-test", help="score outreach variants from analytics")
    p_ab.add_argument("--campaign-id", type=str, default=None, dest="campaign_id")

    p_reach_all = sub.add_parser(
        "reach-all", help="personalize → copywrite → channel → send"
    )
    p_reach_all.add_argument("--icp", type=int, default=None, dest="icp_id")
    p_reach_all.add_argument("--limit", type=int, default=None)
    p_reach_all.add_argument("--dry-run", action="store_true", dest="dry_run")
    p_reach_all.add_argument("--sender", choices=["instantly", "gmail"], default="instantly")

    return parser


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    feature = args.feature

    # ---- FIND ----------------------------------------------------------- #
    if feature == "find":
        find_leads.find_leads(args.prompt, args.max_leads)
    elif feature == "icp":
        icp_id = find_leads.define_icp(args.prompt)
        print(icp_id)
    elif feature == "leads":
        find_leads.generate_leads(args.icp_id, args.max_leads)
    elif feature == "enrich":
        enrich.enrich_leads(args.icp_id, args.limit)
    elif feature == "signals":
        signals.detect_signals(args.icp_id, args.lookback_days, args.limit)
    elif feature == "score":
        score.score_leads(args.mode, args.lead_id, args.icp_id, args.limit)
    elif feature == "find-all":
        start = time.perf_counter()
        icp_id = find_leads.define_icp(args.prompt)
        find_leads.generate_leads(icp_id, args.max_leads)
        enrich.enrich_leads(icp_id)
        signals.detect_signals(icp_id)
        score.score_leads(mode="icp_id", icp_id=icp_id)
        _bar(f"✓ FIND COMPLETE — ICP #{icp_id} · {time.perf_counter() - start:.1f}s")

    # ---- UNDERSTAND ----------------------------------------------------- #
    elif feature == "account-intel":
        account_intel.build_account_intelligence(args.icp_id, args.limit)
    elif feature == "stakeholders":
        stakeholders.map_stakeholders(args.icp_id, args.limit)
    elif feature == "competitive":
        competitive.gather_competitive_intel(args.icp_id, args.max_competitors)
    elif feature == "market-sizing":
        market_sizing.size_markets()
    elif feature == "gtm-brief":
        gtm_brief.generate_insights(args.icp_id, args.limit)
    elif feature == "approve-brief":
        if args.lead_id is None and not args.approve_all:
            print("  ⚠ specify --lead <id> or --all (optionally with --icp)")
            return 2
        gtm_brief.approve_insights(
            lead_id=args.lead_id, icp_id=args.icp_id, reviewed_by=args.reviewed_by
        )
    elif feature == "understand-all":
        start = time.perf_counter()
        account_intel.build_account_intelligence(args.icp_id, args.limit)
        stakeholders.map_stakeholders(args.icp_id, args.limit)
        competitive.gather_competitive_intel(args.icp_id, args.max_competitors)
        market_sizing.size_markets()
        gtm_brief.generate_insights(args.icp_id, args.limit)
        _bar(f"✓ UNDERSTAND COMPLETE — {time.perf_counter() - start:.1f}s")

    # ---- REACH ---------------------------------------------------------- #
    elif feature == "personalize":
        personalize.run_personalisation(args.icp_id, args.limit)
    elif feature == "copywrite":
        copywriter.run_copywriting(args.icp_id, args.limit)
    elif feature == "channel":
        channel.run_channel_strategy(args.icp_id, args.limit)
    elif feature == "send":
        send.send_outreach(args.icp_id, args.limit, args.dry_run, args.sender)
    elif feature == "ab-test":
        ab_testing.run_ab_testing(args.campaign_id)
    elif feature == "reach-all":
        start = time.perf_counter()
        personalize.run_personalisation(args.icp_id, args.limit)
        copywriter.run_copywriting(args.icp_id, args.limit)
        channel.run_channel_strategy(args.icp_id, args.limit)
        send.send_outreach(args.icp_id, args.limit, args.dry_run, args.sender)
        _bar(f"✓ REACH COMPLETE — {time.perf_counter() - start:.1f}s")

    return 0


if __name__ == "__main__":
    sys.exit(main())
