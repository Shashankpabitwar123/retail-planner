# Verification — October 4, 2026

62 Python tests and 13 TypeScript tests passed. TypeScript checking, Vite production build and production Docker build passed. One TestClient dependency deprecation warning remains. The tests cover normalization, ownership, queue recovery, forecast evaluation, inventory arithmetic, read-only preview explanations, bounded row access, headers-only mapping, validated backups and browser storage failures.

## Browser and container checks

Final local flow: complete synthetic sample → live AI column suggestions → explicit semantic confirmations → quality review → forecast → stock preview → live preview explanation → source navigation → explicit apply. Forecast totals were 364, 156 and 12 units. The Notebook scenario suggested 132 units with 35 unmet units before arrival. These historical examples are labelled replay.

Earlier browser checks verified actual Chrome downloads (84 daily forecast rows and matching totals), inventory backup restoration, refresh, desktop layout and 390px mobile overflow. The final pass added mapping and preview interaction checks; this is not every browser/device combination.

A fresh production Docker build passed under local free-profile constraints (512 MiB, 0.1 CPU): website, HttpOnly session, row limit, upload/review/forecast/export and live OpenAI response. Hosting configuration enables Secure cookies for HTTPS; localhost HTTP does not.

`evidence/final-ai-checks.json` records live mapping, a date-specific normalized-data answer, and explanation of an unapplied 132-unit scenario, including token counts and latency. The assistant did not apply a plan. A separate adversarial-product-name example passed at its recorded checkpoint. These are limited checks, not proof that all AI answers are correct.

## Performance and forecast limits

- Local free-resource container: 50,000 rows, 100 products, approximately 50.7 seconds end-to-end and 115 MB peak cgroup memory. Not an actual Render or concurrency guarantee.
- Local in-process checkpoint: 200,000 rows, 500 products, approximately 2.35 seconds; excludes network, persistence, browser and AI. An earlier unrestricted local HTTP checkpoint took about 4.09 seconds.
- Expanded UCI development evaluation: 30 additional products from one retailer; 28 defined WAPEs with median about 106.5%, two undefined because actual totals were zero. One retailer is not representative multi-store qualification.
- No millions-of-rows, guaranteed-accuracy or automated purchasing claims are supported.

## Remaining qualification boundaries

Public Render deployment passed upload/review/forecast/export and a live AI request, with HTTPS Secure and HttpOnly cookies; see `evidence/public-smoke.json`. No error logs were returned at launch inspection. Concurrent load, complete screen-reader coverage, independent security review and representative business validation are not complete. The 72-item acceptance register records scoped evidence and partial UI checks; it is not 72 automated tests. Backup checksums detect accidental corruption, not authenticity. Free-host records can disappear; browser history and downloads are separate.

Final free-profile browser reset check passed: after recreating the container, the expired-analysis message appeared; saved history reopened all three forecasts, with re-upload required for live AI/recalculation. See `evidence/free-reset-browser.json`.
