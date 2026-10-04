# Retail Planner — portfolio copy

## Project card

**Retail Planner · Sales forecasting and inventory planning**

I built a no-login app that converts retail CSV exports into checked daily sales data, evaluates product-level forecasts, and produces inventory scenarios with downloadable results. It explains when missing data or poor historical performance makes a recommendation unreliable.

**Tech:** Python, FastAPI, React, TypeScript, SQLite, statistical forecasting, OpenAI Responses API, Docker.

## What the demonstration shows

- Import three CSV layouts while preserving product IDs, date meaning, returns and stockout information.
- Compare six forecasting methods chronologically, separating selection, calibration and final evaluation.
- Calculate inventory needs from dated stock and incoming orders, with explicit preview/apply and saved assumptions.
- Provide a read-only AI assistant whose answers link back to the selected analysis.
- Recover jobs, isolate anonymous browser sessions, export results and restore portable workspaces.

## Evidence to discuss in an interview

The synthetic fixture has 588 product-days and 3,724 units across equivalent input layouts. The known inventory arithmetic case returns a 96-unit suggestion and 5 unmet units before arrival. Local performance measurements and exact workloads are saved in `evidence/`; they are not hosting or concurrency guarantees.

The original real-data benchmark had high errors. An expanded 30-product development check from the same retailer had defined WAPE for 28 products and median WAPE of approximately 106.5%; two had zero actual totals and undefined WAPE. I kept those results visible, limited the product claims, and withheld inventory when the internal error safeguard failed. A low synthetic error is not evidence of general retail accuracy.

## Demo walkthrough

Open the complete synthetic sample → confirm data meaning → review quality → generate forecasts → select Notebook → enter 25 units in stock, 5-day lead time, 7-day review, 2-day buffer and pack size 12 → preview the 132-unit scenario → apply → ask about the applied order → download the results.

A second walkthrough should use the missing-date sample to demonstrate the app declining unsupported predictions. Uploaded historical examples are labelled historical replay.

## Publication status

The source and copy are prepared locally. Insert a verified live URL and repository URL only after publication. Do not claim a live service, guaranteed accuracy, universal store compatibility, or millions-of-rows capacity before those are actually established.
