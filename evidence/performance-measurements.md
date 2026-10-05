# Performance measurements

The 20 MiB upload allowance is experimental on the existing free service. Limits: 12 files combined, 200,000 input rows, 100 products, 200,000 product-days, 3,000,000 cells. A file's byte size alone does not establish processing capacity.

Every completed, failed or canceled worker attempt stores a `performance` record with its owner-protected job response. JSON application logs use `event=retail_performance`. POST request logs use route templates and omit filenames, file contents, answers and secrets. Existing cache reuse does not execute a new worker attempt; timings on a cached job describe the original attempt.

- HTTP wall time covers the server request until response construction, including upload reading and batch/AI preparation when invoked. It excludes browser rendering and network response delivery.
- Worker wall time includes reading settings, computation, serialization and persistence. Stage timers separate normalization, reading the saved review, forecasting and serialization.
- `job_age_at_start_seconds` is elapsed time since original job creation, not pure queue wait after a retry or restart.
- CPU time and memory describe the shared process. Current RSS is provided on Linux. Peak RSS is the process lifetime high-water mark, not memory allocated by a single job. Concurrent requests can contribute.
- A killed process may have no final measurement. Inspect Render memory metrics and restart logs for that case.
- The local TestClient benchmark runs client and server in one process. Its memory and duration are not equivalent to live Render measurements.

After the user runs the large file, retrieve Render application logs filtered by `retail_performance`. Report upload, preparation, normalize and forecast separately; do not count time answering questions or describe local timings as live. Record cached versus fresh runs and keep cold and warm runs separate.
