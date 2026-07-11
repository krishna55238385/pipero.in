import json
import os

from openai import OpenAI

from gtm_backend.phase1.core.config import get_settings
from gtm_backend.phase1.core.retries import retry_on_transient


_settings = get_settings()
_client = OpenAI(
    base_url="https://api.groq.com/openai/v1",
    api_key=os.getenv("GROQ_API_KEY", ""),
)



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
    model = model or os.getenv("GROQ_MODEL", "llama-3.1-70b-versatile")
    response = _client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": f"{system}\n\nRespond only in valid JSON format."},
            {"role": "user", "content": user},
        ],
        temperature=temperature,
    )
    # Record usage for EVERY completed API call — before any content validation
    # that could raise — so even a malformed/empty response logs the spend.
    usage = response.usage
    prompt_tokens = getattr(usage, "prompt_tokens", 0) or 0
    completion_tokens = getattr(usage, "completion_tokens", 0) or 0
    total_tokens = getattr(usage, "total_tokens", 0) or 0
    cost = (
        prompt_tokens * _settings.openai_input_cost_per_1m
        + completion_tokens * _settings.openai_output_cost_per_1m
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
