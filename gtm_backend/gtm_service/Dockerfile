# GTM trigger service — runs the phase1/2/3 CLIs on demand + GA4 ingest +
# phase3 email tracking. Build context is the repo ROOT (so phase packages
# are importable): `docker build -f gtm_backend/gtm_service/Dockerfile .`
FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Install deps first for layer caching.
COPY gtm_backend/gtm_service/requirements.txt /app/gtm_backend/gtm_service/requirements.txt
RUN pip install --no-cache-dir -r /app/gtm_backend/gtm_service/requirements.txt

# Copy the whole repo (gtm_backend (phase1/2/3) + gtm_service). .dockerignore trims junk.
COPY . /app

EXPOSE 8080

# Render/Railway inject $PORT; default 8080 for local runs.
CMD ["sh", "-c", "uvicorn gtm_backend.gtm_service.app:app --host 0.0.0.0 --port ${PORT:-8080}"]
