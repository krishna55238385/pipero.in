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

# BYO LLM (org-supplied API key/model, via OpenRouter): when a client saves
# their own OpenRouter key + model choice in the CRM settings page,
# gtm_service/runner.py injects OPENROUTER_API_KEY/OPENROUTER_MODEL into this
# subprocess's environment before launching it. When present, every chat_json
# call routes through the client's own OpenRouter account/model instead of
# the platform's shared Groq key. Unset = no change from today's behaviour.
_OPENROUTER_KEY = os.getenv("OPENROUTER_API_KEY", "")
_OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "") or "meta-llama/llama-3.3-70b-instruct"
_client_openrouter = (
    OpenAI(base_url="https://openrouter.ai/api/v1", api_key=_OPENROUTER_KEY, timeout=30.0)
    if _OPENROUTER_KEY else None
)

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
    if _client_openrouter is not None:
        try:
            return _client_openrouter.chat.completions.create(
                model=_OPENROUTER_MODEL, messages=messages, temperature=temperature,
                response_format={"type": "json_object"},
            )
        except Exception as exc:
            # Client's own OpenRouter key/model failed (bad key, model quota,
            # etc.) — fall through to the platform's own Groq key below
            # rather than failing this call outright. Matches the layered
            # fallback used everywhere else in this codebase: client key ->
            # platform default -> per-item skip (handled by the caller).
            print(f"  [OpenRouter] org-supplied key/model failed ({exc}) — falling back to platform default.")
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
    """Call Groq (platform default) with JSON mode, unless this process has an
    org-supplied OPENROUTER_API_KEY, in which case OpenRouter is used instead
    (see _chat_completion_with_fallback). Returns parsed dict. Raises on
    failure once every available fallback has also failed.

    The model defaults to GROQ_MODEL from the root .env when calling Groq;
    callers may still pass an explicit override. When routed through
    OpenRouter, the model is whatever the org chose (_OPENROUTER_MODEL),
    ignoring this parameter.
    """
    model = model or os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
    response = _chat_completion_with_fallback(model, system, user, temperature)
    # Record usage for EVERY completed API call — before any content validation
    # that could raise — so even a malformed/empty response logs the spend.
    usage = response.usage
    prompt_tokens = getattr(usage, "prompt_tokens", 0) or 0
    completion_tokens = getattr(usage, "completion_tokens", 0) or 0
    total_tokens = getattr(usage, "total_tokens", 0) or 0
    # NOTE: this always prices against Groq's own per-token rates, even for a
    # call that actually routed through a client's OpenRouter key/model above.
    # Token counts are still accurate; the $ estimate just isn't meaningful
    # for OpenRouter-routed calls (different providers/models price
    # differently) — acceptable for now since it only affects our OWN cost
    # dashboard, not anything the client is billed for (they pay OpenRouter
    # directly on their own key). Worth revisiting if per-model cost accuracy
    # ever matters here.
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
