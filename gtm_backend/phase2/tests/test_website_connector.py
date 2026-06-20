"""Unit tests for the free direct-website fetcher (phase2.connectors.website).

The autouse `_block_real_http` fixture patches ``httpx.Client.get`` at the class
level; here we override the connector's own client *instance* with a fake so we
exercise the real extraction/loop logic without touching the network.
"""
import httpx

from gtm_backend.phase2.connectors import website


def _resp(url: str, status: int, html: str) -> httpx.Response:
    return httpx.Response(
        status,
        html=html,
        request=httpx.Request("GET", url),
    )


_HOME_HTML = """
<html><head><title>Acme HR — people platform</title>
<meta name="description" content="HR, payroll and onboarding for Indian SMBs.">
<script>var x = 'should not leak into text';</script>
<style>.h{color:red}</style></head>
<body><nav>Menu</nav>
<h1>Acme HR</h1>
<p>Acme HR builds an all-in-one people platform: payroll, onboarding,
compliance and performance for mid-market HR teams across India.</p>
</body></html>
"""


def test_fetch_company_pages_extracts_clean_text(mocker):
    """Homepage returns real HTML; script/style is stripped, title+meta kept,
    and a clean snippet with the page URL as source is returned.
    """
    def fake_get(url, *args, **kwargs):
        if url.rstrip("/") == "https://acmehr.com":
            return _resp("https://acmehr.com/", 200, _HOME_HTML)
        return _resp(url, 404, "not found")

    mocker.patch.object(website._client, "get", side_effect=fake_get)

    pages = website.fetch_company_pages("acmehr.com")

    assert len(pages) == 1
    page = pages[0]
    assert page["source_url"].startswith("https://acmehr.com")
    assert "people platform" in page["text"]          # title captured
    assert "payroll" in page["text"]                  # body captured
    assert "should not leak" not in page["text"]      # <script> stripped
    assert "color:red" not in page["text"]            # <style> stripped


def test_fetch_company_pages_returns_empty_on_unreachable(mocker):
    """Every request raising a transport error yields [] (caller falls through)."""
    def boom(url, *args, **kwargs):
        raise httpx.ConnectError("no route to host")

    mocker.patch.object(website._client, "get", side_effect=boom)
    assert website.fetch_company_pages("nope.invalid") == []


def test_fetch_company_pages_ignores_thin_pages(mocker):
    """A reachable page with almost no text is not returned as a snippet."""
    def thin(url, *args, **kwargs):
        return _resp(url, 200, "<html><body>hi</body></html>")

    mocker.patch.object(website._client, "get", side_effect=thin)
    assert website.fetch_company_pages("acmehr.com") == []


def test_fetch_company_pages_blank_domain():
    assert website.fetch_company_pages("") == []
