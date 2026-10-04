FROM node:22-bookworm-slim AS frontend
WORKDIR /build
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.13-slim-bookworm
WORKDIR /app
COPY requirements.lock.txt ./
RUN pip install --no-cache-dir -r requirements.lock.txt
COPY backend/ backend/
COPY --from=frontend /build/dist frontend/dist/
COPY --from=frontend /build/public/samples samples/
ENV RETAIL_SERVE_FRONTEND=1 RETAIL_DB=/var/data/retail.sqlite3
CMD ["sh", "-c", "uvicorn backend.app:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
