"""GTM trigger service.

A small FastAPI app that lets the pipero.in CRM kick off the Python phase1/2/3
pipelines on demand (Vercel can't run Python), tracks each run in phase_runs,
ingests GA4 website-visitor signals, and serves the phase3 email open/unsubscribe
tracking endpoints. Deploy on an always-on host (Render/Railway).
"""
