import json
import os

from openai import OpenAI, RateLimitError

from gtm_backend.phase1.core.config import get_settings
from gtm_backend.phase1.core.retries import retry_on_transient


_settings = get_settings()
_client = OpenAI(
    base_url="https://api.groq.com/openai/v1",
    api_key=os.getenv("GROQ_API_KEY", ""),
    timeout=30.0,
)

# Optional second Groq account/key — used as a fallback when the primary key's
# daily token quota (TPD) is exhausted. Unset = no fallback, same behaviour as
# before (RateLimitError propagates to the caller's own fallback logic, if
# any). Mirrors the SerpAPI -> Serper.dev fallback pattern.
_FALLBACK_KEY = os.getenv("GROQ_API_KEY_2", "")
_client_fallback = (
    OpenAI(base_url="https://api.groq.com/openai/v1", api_key=_FALLBACK_KEY, timeout=30.0)
    if _FALLBACK_KEY else None
)
# Once the primary key hits its daily quota, stop retrying it for the rest of
# this process — go straight to the fallback client on every subsequent call.
_use_fallback = False

_ORG_ID = _settings.gtm_org_id or None


def log_usage(
    agent: str,
    model: str,
    usage: object,
    cost: float,
    icp_id: int | None,
    phase: str | None = None,
) -> None:
    """Fire-and-forget: persist usage row or fall back to stdout."""
    prompt_tokens = getattr(usage, "prompt_tokens", 0) or 0
    completion_tokens = getattr(usage, "completion_tokens", 0) or 0
    total_tokens = getattr(usage, "total_tokens", 0) or 0
    try:
        import psycopg2
        import os
        conn = psycopg2.connect(os.getenv("DATABASE_URL"))
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO public.token_usage_logs
               (model, feature, total_tokens, estimated_cost_usd, date, organization_id)
               VALUES (%s, %s, %s, %s, CURRENT_DATE, %s)""",
            (model, phase or agent, total_tokens, cost, _ORG_ID)
        )
        conn.commit()
        cur.close()
        conn.close()
    except Exception:
        print(
            f"[LLM usage] phase={phase} agent={agent} model={model} "
            f"tokens={total_tokens} cost=${cost:.6f}"
        )


def _chat_completion_with_fallback(model: str, system: str, user: str, temperature: float):
    """Call Groq, switching to the fallback key on a daily-quota rate limit.

    Once the primary key's TPD (tokens-per-day) limit is hit, every later call
    in this process goes straight to the fallback client — no point re-trying
    a key that's already known to be exhausted for the day.
    """
    global _use_fallback
    messages = [
        {"role": "system", "content": f"{system}\n\nRespond only in valid JSON format."},
        {"role": "user", "content": user},
    ]
    if _use_fallback and _client_fallback is not None:
        return _client_fallback.chat.completions.create(
            model=model, messages=messages, temperature=temperature,
            response_format={"type": "json_object"},
        )
    try:
        return _client.chat.completions.create(
            model=model, messages=messages, temperature=temperature,
            response_format={"type": "json_object"},
        )
    except RateLimitError:
        if _client_fallback is None:
            raise
        print("  [Groq] ⚠ primary key rate-limited (daily quota) — switching to fallback key.")
        _use_fallback = True
        return _client_fallback.chat.completions.create(
            model=model, messages=messages, temperature=temperature,
            response_format={"type": "json_object"},
        )


@retry_on_transient(max_attempts=2)
def chat_json(
    system: str,
    user: str,
    model: str | None = None,
    temperature: float = 0.1,
    agent: str = "unknown",
    icp_id: int | None = None,
    phase: str = "phase1",
) -> dict:
    """Call OpenRouter with JSON mode. Returns parsed dict. Raises on failure.

    The model defaults to OPENROUTER_MODEL from the root .env (the project's
    single source of truth); callers may still pass an explicit override.
    """
    model = model or os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
    response = _chat_completion_with_fallback(model, system, user, temperature)
    # Record usage for EVERY completed API call — before any content validation
    # that could raise — so even a malformed/empty response logs the spend.
    usage = response.usage
    prompt_tokens = getattr(usage, "prompt_tokens", 0) or 0
    completion_tokens = getattr(usage, "completion_tokens", 0) or 0
    total_tokens = getattr(usage, "total_tokens", 0) or 0
    cost = (
        prompt_tokens * _settings.groq_input_cost_per_1m
        + completion_tokens * _settings.groq_output_cost_per_1m
    ) / 1_000_000
    log_usage(agent=agent, model=model, usage=usage, cost=cost, icp_id=icp_id, phase=phase)

    content = response.choices[0].message.content
    if not content:
        raise RuntimeError("OpenAI returned empty/invalid JSON")
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as exc:
        raise RuntimeError("OpenAI returned empty/invalid JSON") from exc

    print(f"  [LLM] phase={phase} agent={agent} → {len(parsed)} keys, {total_tokens} tokens, ${cost:.6f}")

    return parsed
