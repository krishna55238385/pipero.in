"""Guard test: the entity-disambiguation rule added to
SIGNAL_CLASSIFICATION_SYSTEM (fix for name-collision false positives, e.g. a
company named the same as an unrelated TV show/person) must stay present.
Prevents a future edit from silently dropping it."""
from gtm_backend.phase1.core.prompts import SIGNAL_CLASSIFICATION_SYSTEM


def test_entity_check_instruction_present():
    prompt = SIGNAL_CLASSIFICATION_SYSTEM.lower()
    assert "entity check" in prompt
    assert "unrelated" in prompt
    assert "target company" in prompt


def test_entity_check_happens_before_type_intent_rubric():
    prompt = SIGNAL_CLASSIFICATION_SYSTEM
    entity_idx = prompt.lower().find("entity check")
    rubric_idx = prompt.lower().find("buying_intent rubric")
    assert entity_idx != -1 and rubric_idx != -1
    assert entity_idx < rubric_idx
