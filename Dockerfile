# Multi-stage, one application process; see docs/DEPLOYMENT.md for replica boundaries.
FROM node:24-bookworm-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.13-slim-bookworm AS application
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=/app/backend \
    ATLAS_DATABASE_PATH=/data/atlas.sqlite3 ATLAS_FRONTEND_PATH=/app/frontend/dist
WORKDIR /app
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir --require-hashes -r /app/backend/requirements.txt \
    && useradd --create-home --uid 10001 atlas \
    && mkdir -p /data && chown atlas:atlas /data
COPY backend/atlas_app /app/backend/atlas_app
COPY --from=frontend /app/frontend/dist /app/frontend/dist
COPY LICENSE THIRD_PARTY_NOTICES.md /app/
USER 10001:10001
EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=4s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:7860/api/v1/ready', timeout=3)"
CMD ["python","-m","uvicorn","atlas_app.main:app","--host","0.0.0.0","--port","7860","--workers","1","--no-access-log","--no-proxy-headers","--timeout-keep-alive","15","--timeout-graceful-shutdown","20","--limit-concurrency","120"]
