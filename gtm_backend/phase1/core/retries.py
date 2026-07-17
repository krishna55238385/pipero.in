import httpx
import psycopg2
from google.genai import errors as genai_errors
from tenacity import (
    retry,
    retry_if_exception,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)


def retry_on_transient(max_attempts: int = 3):
    """Retry only on transport-level failures (connect/read/write/timeout).

    Deliberately does NOT retry ``httpx.HTTPStatusError`` / ``SupabaseError``
    (4xx/5xx *responses*). A non-idempotent POST that inserts a row and then
    gets a 5xx while serialising the response would be DUPLICATED on retry; a
    transport error, by contrast, means the HTTP exchange never completed with
    a status, so retrying is safe. ``httpx.TransportError`` already covers all
    timeout subclasses. ``psycopg2.OperationalError`` is the direct-Postgres
    equivalent (connection refused/dropped, timeout) for the connectors that
    talk to RDS directly instead of over HTTP.
    """
    return retry(
        retry=retry_if_exception_type((httpx.TransportError, ConnectionError, psycopg2.OperationalError)),
        stop=stop_after_attempt(max_attempts),
        wait=wait_exponential(multiplier=1, min=1, max=10),
        reraise=True,
    )


def _is_rate_limited(exc: BaseException) -> bool:
    if not isinstance(exc, genai_errors.APIError):
        return False
    return getattr(exc, "code", None) == 429 or "RESOURCE_EXHAUSTED" in str(exc)


def retry_on_rate_limit(max_attempts: int = 5):
    """Retry Gemini calls that hit 429 RESOURCE_EXHAUSTED, backing off between tries.

    Safe to retry unconditionally (unlike ``retry_on_transient``'s 4xx/5xx
    exclusion): ``chat_json`` is a pure LLM call with no side effect of its
    own, so resending it after a 429 can never duplicate a write the way
    retrying a POST that already inserted a row would.
    """
    return retry(
        retry=retry_if_exception(_is_rate_limited),
        stop=stop_after_attempt(max_attempts),
        wait=wait_exponential(multiplier=2, min=2, max=30),
        reraise=True,
    )
