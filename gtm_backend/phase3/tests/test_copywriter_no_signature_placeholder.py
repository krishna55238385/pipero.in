"""Guard test: COPYWRITER_SYSTEM must forbid closing signatures and bracket
placeholders. A literal "[Your Name]" reached a real send on ICP #62
(2026-09-04, lead 10555/InvGate) because the prompt never told the model to
omit a sign-off, and nothing downstream (outreach_sequences ->
engage-worker.ts's renderTemplate) ever fills or strips one."""
from gtm_backend.phase3.core.prompts import COPYWRITER_SYSTEM


def test_forbids_closing_signature_lines():
    prompt = COPYWRITER_SYSTEM.lower()
    assert "never end a message with a closing signature" in prompt


def test_forbids_bracket_placeholders():
    prompt = COPYWRITER_SYSTEM.lower()
    assert "[your name]" in prompt
    assert "bracket placeholder" in prompt


def test_no_signature_rule_present_alongside_plain_text_rule():
    # Anchored near the existing "plain text only" formatting rule so it's
    # read as part of the same output-shape guidance, not buried elsewhere.
    prompt = COPYWRITER_SYSTEM.lower()
    plain_text_idx = prompt.find("plain text only")
    no_signature_idx = prompt.find("never end a message with a closing signature")
    assert plain_text_idx != -1 and no_signature_idx != -1
    assert no_signature_idx - plain_text_idx < 400
