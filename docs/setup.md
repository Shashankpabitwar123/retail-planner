# Run Retail Planner

Use Python 3.13 and Node 20.19+.

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.lock.txt
npm ci --prefix frontend
```

Start the backend and frontend in separate terminals:

```sh
.venv/bin/python -m uvicorn backend.app:app --host 127.0.0.1 --port 8001
```

```sh
npm run dev --prefix frontend
```

Open http://127.0.0.1:5174/ and upload your sales CSV. Include a date, product identifier and whole units sold. The app asks about details it cannot infer, including whether the export is complete.

## Optional assistant

Set `OPENAI_API_KEY` on the backend or point `RETAIL_ENV_FILE` to an ignored local environment file. Never use a `VITE_` variable for a secret. `OPENAI_MODEL` defaults to `gpt-4.1-mini`.

Data preparation, forecasting and inventory calculations work without an API key. The assistant explains selected analysis results; it does not calculate the statistical forecasts or place orders.

## Checks

```sh
npm run build --prefix frontend
PYTHONPATH=. .venv/bin/python -m pytest tests -q
npm test --prefix frontend
```

## Hosting

The [Dockerfile](../Dockerfile) serves the website and API together. The current [render.yaml](../render.yaml) configures one free service with a 20 MiB upload limit, 200,000 rows, 100 products and 200,000 product-days. Those settings are limits, not throughput guarantees. The alternate `render-free.yaml` has smaller limits; `render-paid.yaml` adds persistent storage.

Use one process and one instance with SQLite. Set `RETAIL_ORIGINS` to the assigned HTTPS origin and `RETAIL_SECURE_COOKIE=1` in production. `/api/health` checks database access. Auto-deploy is disabled in the configuration, so publishing a source change does not deploy the app.

Temporary server uploads and jobs can disappear after a restart. Browser history and downloaded analyses are stored separately. Re-upload the original files to calculate again after server records expire.

```sh
docker build -t retail-planner:local .
docker run --rm -p 127.0.0.1:8002:8000 -e RETAIL_ORIGINS=http://127.0.0.1:8002 retail-planner:local
```
