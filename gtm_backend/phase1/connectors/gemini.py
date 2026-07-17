import json
import re

from google import genai
from google.genai import types

from gtm_backend.phase1.core.config import get_settings
from gtm_backend.phase1.core.retries import retry_on_rate_limit, retry_on_transient


_settings = get_settings()
_client = genai.Client(api_key=_settings.gemini_api_key)

_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE | re.MULTILINE)


def _strip_markdown_fence(text: str) -> str:
    """Gemini sometimes wraps JSON in ```json ... ``` fences despite being told
    not to (reproduced directly against the live API); strip them defensively.
    """
    return _FENCE_RE.sub("", text.strip()).strip()


def log_usage(
    agent: str,
    model: str,
    usage: object,
    cost: float,
    icp_id: int | None,
    phase: str | None = None,
) -> None:
    """Fire-and-forget: persist usage row or fall back to stdout."""
    prompt_tokens = getattr(usage, "prompt_token_count", 0) or 0
    completion_tokens = getattr(usage, "candidates_token_count", 0) or 0
    total_tokens = getattr(usage, "total_token_count", 0) or 0
    try:
        import psycopg2
        import os
        conn = psycopg2.connect(os.getenv("DATABASE_URL"))
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO public.token_usage_logs
               (model, feature, total_tokens, estimated_cost_usd, date)
               VALUES (%s, %s, %s, %s, CURRENT_DATE)""",
            (model, phase or agent, total_tokens, cost)
        )
        conn.commit()
        cur.close()
        conn.close()
    except Exception:
        print(
            f"[LLM usage] phase={phase} agent={agent} model={model} "
            f"tokens={total_tokens} cost=${cost:.6f}"
        )


@retry_on_transient()
@retry_on_rate_limit()
def chat_json(
    system: str,
    user: str,
    model: str | None = None,
    temperature: float = 0.1,
    agent: str = "unknown",
    icp_id: int | None = None,
    phase: str = "phase1",
) -> dict:
    """Call Gemini with JSON mode. Returns parsed dict. Raises on failure.

    The model defaults to GEMINI_MODEL from the root .env (the project's
    single source of truth); callers may still pass an explicit override.
    """
    model = model or _settings.gemini_model
    response = _client.models.generate_content(
        model=model,
        contents=user,
        config=types.GenerateContentConfig(
            system_instruction=f"{system}\n\nRespond only in valid JSON format.",
            temperature=temperature,
        ),
    )
    # Record usage for EVERY completed API call — before any content validation
    # that could raise — so even a malformed/empty response logs the spend.
    usage = response.usage_metadata
    prompt_tokens = getattr(usage, "prompt_token_count", 0) or 0
    completion_tokens = getattr(usage, "candidates_token_count", 0) or 0
    total_tokens = getattr(usage, "total_token_count", 0) or 0
    cost = (
        prompt_tokens * _settings.gemini_input_cost_per_1m
        + completion_tokens * _settings.gemini_output_cost_per_1m
    ) / 1_000_000
    log_usage(agent=agent, model=model, usage=usage, cost=cost, icp_id=icp_id, phase=phase)

    # response.text raises ValueError instead of returning None when a candidate
    # was blocked/empty — normalize that to the same "missing content" path below.
    try:
        content = response.text
    except ValueError:
        content = None
    if not content:
        raise RuntimeError("Gemini returned empty/invalid JSON")
    content = _strip_markdown_fence(content)
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as exc:
        raise RuntimeError("Gemini returned empty/invalid JSON") from exc

    print(f"  [LLM] phase={phase} agent={agent} → {len(parsed)} keys, {total_tokens} tokens, ${cost:.6f}")

    return parsed
