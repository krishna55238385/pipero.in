"""Env stub for the phase4 test suite — phase4 imports phase3's connectors
directly (shared Groq/RDS clients), which instantiate pydantic Settings at
import time. Mirrors phase3/tests/conftest.py exactly so the same stub values
satisfy both test suites regardless of import order."""
from __future__ import annotations

import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

os.environ.setdefault("OPENAI_API_KEY", "test")
os.environ.setdefault("OPENAI_MODEL", "gpt-4o-mini")
os.environ.setdefault("GROQ_API_KEY", "test")
os.environ.setdefault("SERP_API_KEY", "test")
os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost/test")
os.environ.setdefault("SUPABASE_URL", "https://stub.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test")
os.environ.setdefault("HUNTER_API_KEY", "test")
