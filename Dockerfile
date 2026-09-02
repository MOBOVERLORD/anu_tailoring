# Build the React application.
FROM node:22-slim AS frontend-build

WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Run FastAPI and serve the compiled React application from one Cloud Run
# ingress container.
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    ENVIRONMENT=production \
    SERVE_FRONTEND=true \
    PORT=8080

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/
COPY alembic.ini ./
COPY migrations/ ./migrations/
COPY --from=frontend-build /build/frontend/dist ./frontend/dist/

RUN addgroup --system vastrivo \
    && adduser --system --ingroup vastrivo vastrivo \
    && chown -R vastrivo:vastrivo /app

USER vastrivo
EXPOSE 8080

# The entrypoint performs a fast schema-head check. If a Git-connected deploy
# bypassed the dedicated migration job, it serializes and applies Alembic before
# replacing itself with Uvicorn. Migration errors still fail the revision.
CMD ["python", "-m", "app.production_startup"]
