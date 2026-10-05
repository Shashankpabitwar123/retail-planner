# Retail Planner

[Live app](https://retail-planner-demo.onrender.com/) · [Source](https://github.com/Shashankpabitwar123/retail-planner)

A no-login website that turns a store's sales CSV into a checked, explainable 28-day sales forecast and an optional inventory plan. React/TypeScript, FastAPI, SQLite, six statistical forecasting methods and an optional OpenAI assistant. No Tableau account is required.

## The user flow

1. Upload a sales CSV. The app detects supported columns, layout and date/number formats automatically.
2. Answer one plain-language question at a time only where the file leaves uncertainty: date order, unknown column, store selection, export completeness or missing days. Recognized sample files need no setup.
3. Clean data continues directly to forecasts. There is no mandatory mapping form or quality approval screen. Products without enough usable data stay clearly labelled.
4. See the forecast and a plain-language past-error summary. Open reliability details only when needed. Stock planning begins with stock count, date and delivery time; other assumptions are disclosed and adjustable under a collapsed section.
5. Download results or save a portable copy. History explains temporary uploaded-file storage and how to keep results. Advanced import controls remain available for exceptional files, not as the default onboarding.

A replacement upload can be compared with an earlier normalized review: unchanged, changed, added and removed keys are reported. Changed/removed records require confirmation. Analyses remain separate; records are never blindly appended.

## Run locally

Python 3.13 and Node 20.19+:

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.lock.txt
npm ci --prefix frontend
```

In separate terminals:

```sh
.venv/bin/python -m uvicorn backend.app:app --host 127.0.0.1 --port 8001
npm run dev --prefix frontend
```

Open http://127.0.0.1:5174/. Configure `OPENAI_API_KEY` on the backend only. In the original Codex workspace it loads from the workspace-root `.env.local`; elsewhere provide the environment variable or set `RETAIL_ENV_FILE` to an ignored local file. Never use a `VITE_` variable for a secret. `OPENAI_MODEL` defaults to `gpt-4.1-mini`.

The deterministic data, forecasting and inventory workflow works without OpenAI. Chat supports date-specific queries of up to 31 days and explanations of unapplied stock previews. Chat uses bounded normalized history, quality summaries, selected forecasts, applied inventory assumptions and recent messages; raw CSV/customer columns are not sent. It has no SQL, code execution, browsing or purchasing tools. Responses are explanations, not verified business facts.

## Hosting

See [DEPLOYMENT.md](DEPLOYMENT.md). `render-free.yaml` provides a free-compute portfolio demo with your existing OpenAI key configured separately as a secret. It has a 10 MiB combined / 100,000-row / 100-product limit (up to 12 CSVs). The increased live limits are pending a large-file capacity check. Temporary server uploads, jobs and chats can disappear when the free host sleeps or restarts; browser history and downloaded files remain separate.

`render-paid.yaml` is an optional paid persistent-storage configuration, not a prerequisite for finishing or showing the project. The public demo is deployed on Render’s free plan; no paid service was created. Free hosting still has shared usage allowances; OpenAI billing remains separate.

Both profiles use one process and one worker. Do not horizontally scale this SQLite architecture. The Dockerfile serves the built website and API together; `/api/health` checks database access. Production cookies require HTTPS and `RETAIL_SECURE_COOKIE=1`; `RETAIL_ORIGINS` must be the exact site origin.

## Statistical and data boundaries

- Under 56 complete days: history only. 56–83 days: untested weekly baseline. 84–167: limited baseline evaluation. At least 168: six candidate methods selected on three earlier 28-day periods, with a separate final 28-day test.
- Candidates: weekly seasonal naive, 28-day mean, 56-day mean, weekday mean, exponential level and Croston-SBA. Training uses only observations available at each cutoff.
- At least 420 days: method selection precedes nine non-overlapping calibration periods and a final test period. Daily absolute residual bands and the period-total band are calibrated separately. The nominal 90% level is not guaranteed under temporal dependence; actual final-period coverage and sample count are shown.
- MAE, WAPE, bias and total error are historical errors. WAPE can exceed 100%; it is never reported as “accuracy.” Undefined metrics stay unavailable.
- Inventory is withheld when historical WAPE is undefined or above a provisional 50% threshold, or the method is worse than the weekly baseline. This is a product safeguard, not a proven service-level guarantee. Current planning also requires aligned current dates and confirmed inventory inputs.
- Real public-data evaluation showed large errors. One retailer is not a representative multi-store validation. This app is a portfolio/research demonstration, not a qualified automated purchasing system.
- Supported CSV layouts are explicit. Excel, monthly-only history, unclassified negatives, net-only sales and fuzzy product joins are refused. Unknown event labels can be explicitly mapped; product name changes require confirmation.

## Storage and limits

Local/default limits: 10 MiB, 200,000 source rows, 1.5 million cells, 500 products, 250,000 product-days. These are limits, not production performance promises. Free-host limits are lower and shown in the interface.

Anonymous access uses an HttpOnly/SameSite cookie and owner-bound server records. Seven-day access expiry, online cleanup, delete, restart recovery, queue cancellation and retries are implemented. Limits include 20 uploads and 40 jobs per browser, 10 pending jobs globally, 200 MiB total raw uploads, 300 MiB results, 20 assistant questions/hour per browser, and a configurable global daily assistant request count. These controls do not constitute a dollar spending cap; on an ephemeral host counters can reset with its database.

Browser history retains at most ten analyses within 25 MiB. Oversized results become clearly labelled summaries, with a reminder to download the full workspace. Storage failures are visible. Portable backups use schema validation and an accidental-corruption checksum; they are not authenticated computation certificates and never grant server access. Legacy revision-1 files remain readable. Applied plan revisions and conversations are bounded; local deletion and server deletion are separate controls.

## Verification and reproducibility

```sh
PYTHONPATH=. .venv/bin/python -m pytest tests -q
npm test --prefix frontend
npm run build --prefix frontend
```

Synthetic fixtures are included in `tests/fixtures/`. See [VERIFICATION.md](VERIFICATION.md), [PHASE-STATUS.md](PHASE-STATUS.md), and `evidence/acceptance-register.csv` for executed checks and remaining qualification limits.

- `scripts/benchmark.py`: local in-process timing; excludes network, browser, database and AI.
- `scripts/benchmark_http.py`: local upload, queue, persistence and forecast timing.
- `scripts/evaluate_uci.py RAW_XLSX`: original three-product benchmark. Its observed holdout informed later development, so it is no longer an independent qualification dataset for the current engine.
- `scripts/evaluate_uci_development.py RAW_XLSX`: 30 additional products selected deterministically using training-period eligibility only. Retrospective development evidence from the same retailer.

No claim of processing millions of rows in seconds is made.

## Public-data attribution

Daqing Chen, **Online Retail II**, UCI Machine Learning Repository, DOI [10.24432/C5CG6D](https://doi.org/10.24432/C5CG6D), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Adapted only `Year 2010-2011`: positive-priced, positive-quantity numbered invoice lines; daily aggregation; absent dates assigned zero under an explicit coverage assumption; November 10, 2011 training cutoff and November 11–December 8 evaluation; December 9 partial day excluded. These are **positive invoice units**, not verified completed gross sales. Original three IDs and 30 further training-selected IDs are evaluated separately. No customer IDs or raw workbook are bundled. Synthetic samples are clearly marked. No M5 files or models are distributed.
