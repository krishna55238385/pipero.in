"""Guard test: the entity-disambiguation rule added to
ACCOUNT_INTELLIGENCE_SYSTEM (same class of fix as Agent 04's — a company
name colliding with an unrelated same-named entity) must stay present."""
from gtm_backend.phase2.core.prompts import ACCOUNT_INTELLIGENCE_SYSTEM


def test_entity_check_instruction_present():
    prompt = ACCOUNT_INTELLIGENCE_SYSTEM.lower()
    assert "entity check" in prompt
    assert "domain is your disambiguator" in prompt
    assert "unrelated" in prompt


def test_entity_check_comes_before_use_only_supplied_rule():
    prompt = ACCOUNT_INTELLIGENCE_SYSTEM.lower()
    entity_idx = prompt.find("entity check")
    use_only_idx = prompt.find("use only the supplied")
    assert entity_idx != -1 and use_only_idx != -1
    assert entity_idx < use_only_idx
