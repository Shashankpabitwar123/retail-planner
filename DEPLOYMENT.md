# Live deployment

App: https://retail-planner-demo.onrender.com/

Source: https://github.com/Shashankpabitwar123/retail-planner

Render free service deployed October 4, 2026 in the confirmed My Workspace. Existing OpenAI key configured as a server environment secret. Public upload/review/forecast/export and live AI smoke checks passed. Auto-deploy is off; source updates need an explicit Render deploy. No paid compute or disk was created. The direct-created service uses the root page for its health probe; the dedicated `/api/health` endpoint was verified separately.

# Hosting the same application

## Recommended portfolio setup: free compute

Use `render-free.yaml`. It runs the website and API together on one free Render web service, with no paid disk or database. Configure the existing `OPENAI_API_KEY` as a server secret and `RETAIL_ORIGINS` as the exact assigned HTTPS URL. The AI uses the separately funded OpenAI account; free website hosting does not provide free OpenAI usage.

The profile limits each analysis to 10 MiB combined across up to 12 CSVs, 100,000 rows, 1,500,000 cells, 100 products and 100,000 product-days. These increased limits are configured for live user testing, not a validated capacity guarantee. Temporary uploads, jobs, server conversations and rate counters can disappear whenever the host sleeps, restarts or redeploys. The interface discloses this; expired jobs return the user to upload instead of spinning indefinitely. Browser history and downloaded workspaces remain available separately. Re-upload the original CSV to calculate again.

Render documents idle sleep after 15 minutes and a roughly one-minute wake-up. Free instance hours are shared across the workspace. Bandwidth and build allowances also apply; check the existing workspace's usage/spend settings before publication. There is no guaranteed unlimited free service. https://render.com/docs/free

Do not add a free Render Postgres database as a permanent-history shortcut: the documented free database expires after 30 days. This portfolio app deliberately keeps recoverable results in the browser and download files.

## Optional persistent setup

`render-paid.yaml` proposes one Standard service (1 CPU, 2 GB RAM) with a 1 GB persistent disk. Listed compute and disk cost is approximately $25.25/month before workspace fees, bandwidth, tax and OpenAI usage. This is optional and has not been purchased. Prices checked October 4, 2026: https://render.com/pricing

SQLite requires one process and one instance. A persistent disk prevents horizontal scaling and causes brief deployment downtime. Render disk snapshots have their own retention, separate from the app's seven-day active-data expiry. https://render.com/docs/disks

## Release checklist

1. Publish the reviewed, secret-free source to a dedicated GitHub repository.
2. Confirm the destination workspace and its free-hour/build/bandwidth allowances. Use the free Blueprint; do not upgrade the plan implicitly.
3. Supply the assigned site origin and existing OpenAI key as server environment variables. Never commit a key or `.env.local`.
4. Verify HTTPS, Secure/HttpOnly cookies, `/api/health`, upload → review → forecast → inventory → downloads, and a live assistant response.
5. For the free profile, recreate the service and verify that saved browser results still open while vanished server jobs clearly request re-upload. For persistent hosting, verify queued-job recovery after restart.
6. Measure the actual host before publishing a performance claim, then link the verified site and repository from the portfolio.

`RETAIL_AI_DAILY_LIMIT` bounds assistant request counts per database lifetime. It is not a dollar cap, and a free-host reset clears it. Provider-side budgets remain separate. Read-only AI does not place orders or alter source data.

## Local container verification

```sh
docker build -t retail-planner:local .
docker run --rm -p 127.0.0.1:8002:8000 -e RETAIL_ORIGINS=http://127.0.0.1:8002 retail-planner:local
```

Use a local ignored `--env-file` only when testing AI. Do not paste a secret into a shell command or Dockerfile. The production profile sets secure cookies; local HTTP testing leaves secure cookies off. Do not run multiple Uvicorn workers against the same SQLite file.

Rollback uses the last verified image/source revision. Stop the SQLite writer before copying/restoring its database. Free-demo server state is disposable; persistent hosting must retain its mounted data disk during rollback.
