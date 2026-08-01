"""Phase 3 LLM client — routed through Groq (same account/model as phase1),
not real OpenAI. Tags every usage row with phase='phase3' and routes the row
to the SAME llm_usage table (so the dashboard's 'By Phase' view auto-discovers
phase3 with zero changes).

Points at Groq's OpenAI-compatible endpoint using the same GROQ_API_KEY phase1
uses — for testing, phase1 and phase3 share one Groq account and its daily
quota (1,000 req/day, 100,000 tokens/day; resets every 24h). See
phase1/connectors/openai.py for the reference implementation this mirrors.
"""
import json
import os

from openai import OpenAI, RateLimitError

from gtm_backend.phase3.core.config import get_settings
from gtm_backend.phase3.core.retries import retry_on_transient


_settings = get_settings()
_client = OpenAI(
    base_url="https://api.groq.com/openai/v1",
    api_key=os.getenv("GROQ_API_KEY", ""),
    timeout=30.0,
)

# Optional second Groq account/key — used as a fallback when the primary key's
# daily token quota (TPD) is exhausted. Mirrors phase1's connector and the
# SerpAPI -> Serper.dev fallback pattern.
_FALLBACK_KEY = os.getenv("GROQ_API_KEY_2", "")
_client_fallback = (
    OpenAI(base_url="https://api.groq.com/openai/v1", api_key=_FALLBACK_KEY, timeout=30.0)
    if _FALLBACK_KEY else None
)
_use_fallback = False

# BYO LLM (org-supplied API key/model, via OpenRouter) — see phase1's
# connector for the full explanation. gtm_service/runner.py injects
# OPENROUTER_API_KEY/OPENROUTER_MODEL into this subprocess's environment when
# the org has saved their own key in the CRM settings page; unset = no
# change from today's behaviour.
_OPENROUTER_KEY = os.getenv("OPENROUTER_API_KEY", "")
_OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "") or "meta-llama/llama-3.3-70b-instruct"
_client_openrouter = (
    OpenAI(base_url="https://openrouter.ai/api/v1", api_key=_OPENROUTER_KEY, timeout=30.0)
    if _OPENROUTER_KEY else None
)


def _chat_completion_with_fallback(model: str, system: str, user: str, temperature: float):
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


def log_usage(
    agent: str,
    model: str,
    usage: object,
    cost: float,
    icp_id: int | None,
    phase: str | None = "phase3",
) -> None:
    """Fire-and-forget: persist usage row or fall back to stdout."""
    prompt_tokens = getattr(usage, "prompt_tokens", 0) or 0
    completion_tokens = getattr(usage, "completion_tokens", 0) or 0
    total_tokens = getattr(usage, "total_tokens", 0) or 0
    try:
        from gtm_backend.phase3.connectors import supabase
        supabase.insert_llm_usage(
            agent=agent,
            model=model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            estimated_cost_usd=cost,
            icp_id=icp_id,
            phase=phase,
        )
    except Exception:
        print(
            f"[LLM usage] phase={phase} agent={agent} model={model} "
            f"tokens={total_tokens} cost=${cost:.6f}"
        )


@retry_on_transient()
def chat_json(
    system: str,
    user: str,
    model: str | None = None,
    temperature: float = 0.2,
    agent: str = "unknown",
    icp_id: int | None = None,
    phase: str = "phase3",
) -> dict:
    """Call Groq with JSON mode. Returns parsed dict. Raises on failure.

    The model defaults to GROQ_MODEL from the root .env; falls back to
    llama-3.3-70b-versatile (NOT the deprecated 3.1 model) if unset. Callers
    may still pass an explicit override.
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
