"""Tests for the Serper.dev fallback path's error handling (Task #10,
2026-08-22): every Serper call failed live with a bare "400 Bad Request" and
no further detail, making the real cause undiagnosable. _serper_request must
surface the response body on failure while still raising, so callers'
existing exception handling is unaffected."""
from unittest.mock import MagicMock, patch

import httpx
import pytest

from gtm_backend.phase1.connectors import serpapi


def test_serper_request_reraises_and_logs_response_body_on_http_error(capsys):
    mock_response = MagicMock()
    mock_response.status_code = 400
    mock_response.text = '{"message": "Query pattern not allowed for free accounts"}'
    mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
        "400 Bad Request", request=MagicMock(), response=mock_response
    )

    with patch.object(serpapi._client, "post", return_value=mock_response):
        with pytest.raises(httpx.HTTPStatusError):
            serpapi._serper_request({"q": "test query", "engine": "google_news"})

    captured = capsys.readouterr()
    assert "400" in captured.out
    assert "Query pattern not allowed" in captured.out


def test_serper_request_succeeds_normally_when_no_error():
    ok_response = MagicMock()
    ok_response.status_code = 200
    ok_response.json.return_value = {"organic": [{"title": "Acme", "link": "https://acme.com", "snippet": "..."}]}
    ok_response.raise_for_status.return_value = None

    with patch.object(serpapi._client, "post", return_value=ok_response):
        result = serpapi._serper_request({"q": "test query"})

    assert result == {
        "organic_results": [{"title": "Acme", "link": "https://acme.com", "snippet": "..."}]
    }
