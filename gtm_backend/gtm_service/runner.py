"""Subprocess orchestration for phase pipeline runs.

Builds the per-phase CLI command list, runs each step with GTM_ORG_ID injected
into the environment, streams stdout/stderr into the phase_runs.logs column, and
marks the run succeeded/failed. Designed to be launched as a FastAPI BackgroundTask.
"""
from __future__ import annotations

import os
import subprocess
from datetime import datetime, timezone

from gtm_backend.gtm_service import db
from gtm_backend.gtm_service.config import config


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_commands(phase: str, params: dict) -> list[list[str]]:
    """Translate a trigger request into a sequence of `python -m gtm_backend.phaseN ...` argv."""
    icp_id = params.get("icp_id")
    limit = params.get("limit")
    max_leads = params.get("max", params.get("max_leads", 20))

    def _icp_flag(cmd: list[str]) -> list[str]:
        if icp_id is not None:
            cmd += ["--icp", str(icp_id)]
        if limit is not None:
            cmd += ["--limit", str(limit)]
        return cmd

    if phase == "phase1":
        prompt = params.get("prompt")
        if prompt:
            # Apollo-style search: define a fresh ICP from the prompt and run 01->05.
            return [["-m", "gtm_backend.phase1", "run-all", "--prompt", prompt, "--max", str(max_leads)]]
        if icp_id is None:
            raise ValueError("phase1 requires either 'prompt' or 'icp_id'")
        # Re-run discovery/enrich/signals/score for an existing ICP.
        lim = str(limit) if limit is not None else "50"
        steps: list[list[str]] = []
        if not params.get("skip_leads"):
            steps.append(["-m", "gtm_backend.phase1", "leads", "--icp", str(icp_id), "--max", str(max_leads)])
        steps += [
            ["-m", "gtm_backend.phase1", "enrich", "--icp", str(icp_id), "--limit", lim],
            ["-m", "gtm_backend.phase1", "signals", "--icp", str(icp_id), "--limit", lim],
            ["-m", "gtm_backend.phase1", "score", "--mode", "icp_id", "--icp", str(icp_id), "--limit", lim],
        ]
        return steps

    if phase == "signals":
        # Regenerate buying signals on demand. icp_id is optional: when omitted
        # the CLI refreshes signals for ALL leads org-wide (idempotent).
        cmd = ["-m", "gtm_backend.phase1", "signals"]
        if icp_id is not None:
            cmd += ["--icp", str(icp_id)]
        cmd += ["--limit", str(limit) if limit is not None else "50"]
        return [cmd]

    if phase == "phase2":
        return [_icp_flag(["-m", "gtm_backend.phase2", "run-all"])]

    if phase == "phase3":
        cmd = _icp_flag(["-m", "gtm_backend.phase3", "run-all"])
        if params.get("dry_run"):
            cmd.append("--dry-run")
        sender = params.get("sender")
        if sender:
            cmd += ["--sender", sender]
        campaign_id = params.get("campaign_id")
        if campaign_id:
            cmd += ["--campaign-id", str(campaign_id)]
        return [cmd]

    # "prepare" = the full manual prep for one ICP in a single run: find →
    # enrich → signals → score (phase1) → account intel etc. (phase2) →
    # personalize → copywrite → channel plan (phase3 generate, --dry-run so
    # NOTHING is sent). The CRM "Send now" then dispatches from the DB.
    #
    # The "find" step (Agent 02 lead search) used to run unconditionally on
    # every "prepare" click — including the very first click right after ICP
    # creation, which had already just run a full lead search moments earlier.
    # Re-searching costs real SerpAPI + LLM spend even when it finds nothing
    # new (dedup only discards results *after* paying for them). Now it's
    # skipped whenever the ICP already has leads, unless the caller explicitly
    # asks for a fresh search via force_leads=True (the CRM's separate
    # "search for more leads" action).
    if phase == "prepare":
        if icp_id is None:
            raise ValueError("prepare requires 'icp_id'")
        force_leads = bool(params.get("force_leads"))
        skip_leads = (not force_leads) and db.has_existing_leads(icp_id)
        phase1_params = {**params, "skip_leads": skip_leads}
        return (
            build_commands("phase1", phase1_params)
            + build_commands("phase2", params)
            + build_commands("phase3", {**params, "dry_run": True, "sender": None, "campaign_id": None})
        )

    raise ValueError(f"unknown phase: {phase}")


def build_reply_pipeline_commands() -> list[list[str]]:
    """Same 3 steps as the EC2 crontab's reply-pipeline entry (poll inbox →
    detect objections → draft replies), order matters: objections must be
    detected before drafting so a drafted reply already accounts for any
    objection found in the same tick (see agent_18's own documented rule)."""
    return [
        ["-m", "gtm_backend.phase3", "poll-inbox", "--days-back", "1"],
        ["-m", "gtm_backend.phase3", "detect-objections"],
        ["-m", "gtm_backend.phase3", "draft-replies"],
    ]


def build_meeting_pipeline_commands() -> list[list[str]]:
    """Same 4 steps as the EC2 crontab's meeting-pipeline entry, order
    matters: propose→sync→brief→no-show, each depends on the previous
    step's output (see agent_22/23's own module docstrings)."""
    return [
        ["-m", "gtm_backend.phase4", "propose-meetings"],
        ["-m", "gtm_backend.phase4", "sync-meeting-confirmations"],
        ["-m", "gtm_backend.phase4", "generate-meeting-briefs"],
        ["-m", "gtm_backend.phase4", "detect-no-shows"],
    ]


def build_schedule_commands(
    icp_id: int | None,
    leads_per_day: int,
    sender: str | None,
    auto_send: bool,
) -> dict[str, list[list[str]]]:
    """Daily-pipeline argv lists for one gtm_schedules row, keyed by phase.

    phase1 = discovery → enrich → signals → score, phase3 = run-all with the
    schedule's sender (--dry-run when auto_send is off). When icp_id is null the
    schedule is org-wide: `phase1 leads` requires --icp, so discovery is skipped
    and the run refreshes the existing funnel (enrich/signals/score) instead.
    """
    lim = str(leads_per_day)
    if icp_id is not None:
        phase1 = build_commands(
            "phase1", {"icp_id": icp_id, "max": leads_per_day, "limit": leads_per_day}
        )
    else:
        phase1 = [
            ["-m", "gtm_backend.phase1", "enrich", "--limit", lim],
            ["-m", "gtm_backend.phase1", "signals", "--limit", lim],
            ["-m", "gtm_backend.phase1", "score", "--limit", lim],
        ]
    phase3 = build_commands(
        "phase3",
        {
            "icp_id": icp_id,
            "limit": leads_per_day,
            "sender": sender,
            "dry_run": not auto_send,
        },
    )
    return {"phase1": phase1, "phase3": phase3}


def commands_label(commands: list[list[str]]) -> str:
    return " && ".join(config.PYTHON_BIN + " " + " ".join(c) for c in commands)


def command_label(phase: str, params: dict) -> str:
    try:
        return commands_label(build_commands(phase, params))
    except Exception:  # noqa: BLE001 - label is best-effort
        return f"{phase} {params}"


def execute_run(run_id: str, phase: str, params: dict, organization_id: str | None) -> None:
    """Run all steps for a phase sequentially. Updates phase_runs as it goes."""
    try:
        commands = build_commands(phase, params)
    except Exception as exc:  # noqa: BLE001
        db.update_phase_run(
            run_id, status="failed", error=str(exc), completed_at=_now_iso()
        )
        return
    run_commands(run_id, commands, organization_id)


def run_commands(
    run_id: str, commands: list[list[str]], organization_id: str | None
) -> tuple[str, str]:
    """Execute prebuilt argv steps sequentially, streaming into phase_runs.

    Shared by the manual trigger (execute_run) and the scheduler. Returns
    (status, combined_logs) where status is 'succeeded' or 'failed'.
    """
    org = organization_id or config.DEFAULT_ORG_ID or None
    env = {**os.environ}
    if org:
        env["GTM_ORG_ID"] = org

    # BYO API keys: if this org has its own SerpAPI key and/or OpenRouter
    # key+model saved (CRM settings page), override the subprocess's env so
    # every connector picks them up automatically — same mechanism as
    # GTM_ORG_ID above, zero changes needed in any of the 52 agents, since
    # each pipeline step is already a fresh subprocess that reads its
    # connector keys from the environment at import time. Missing/no custom
    # keys = env stays untouched = falls through to the platform's own
    # default keys, exactly like today's behavior.
    org_keys = db.get_org_api_keys(org) if org else {}
    if org_keys.get("serpapi_key"):
        env["SERP_API_KEY"] = org_keys["serpapi_key"]
    if org_keys.get("openrouter_key"):
        env["OPENROUTER_API_KEY"] = org_keys["openrouter_key"]
        if org_keys.get("openrouter_model"):
            env["OPENROUTER_MODEL"] = org_keys["openrouter_model"]

    logs = ""
    db.update_phase_run(run_id, status="running", started_at=_now_iso())

    for cmd in commands:
        argv = [config.PYTHON_BIN, *cmd]
        header = f"\n$ {' '.join(argv)}\n"
        logs = db.append_phase_run_log(run_id, header, logs)
        try:
            proc = subprocess.run(
                argv,
                cwd=config.REPO_ROOT,
                env=env,
                capture_output=True,
                text=True,
                timeout=config.STEP_TIMEOUT,
            )
        except subprocess.TimeoutExpired as exc:
            # subprocess.TimeoutExpired.stdout/.stderr come back as bytes even
            # though text=True is set above (the exception path bypasses the
            # text-decoding subprocess.run() normally applies) — decode before
            # concatenating or this raises TypeError and the run never gets
            # marked failed at all.
            stdout_part = exc.stdout.decode("utf-8", errors="replace") if isinstance(exc.stdout, bytes) else (exc.stdout or "")
            stderr_part = exc.stderr.decode("utf-8", errors="replace") if isinstance(exc.stderr, bytes) else (exc.stderr or "")
            partial = stdout_part + stderr_part
            logs = db.append_phase_run_log(
                run_id, partial + "\n[timeout] step exceeded limit\n", logs
            )
            db.update_phase_run(
                run_id, status="failed", error="step timed out", completed_at=_now_iso()
            )
            return "failed", logs

        out = (proc.stdout or "") + (proc.stderr or "")
        logs = db.append_phase_run_log(run_id, out, logs)

        if proc.returncode != 0:
            db.update_phase_run(
                run_id,
                status="failed",
                error=f"step exited {proc.returncode}",
                completed_at=_now_iso(),
            )
            return "failed", logs

    db.update_phase_run(run_id, status="succeeded", completed_at=_now_iso())
    return "succeeded", logs
