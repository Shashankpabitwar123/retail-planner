"""Deterministic import, chronological evaluation and inventory calculations."""

import csv
import io
import math
import os
import re
from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from statistics import mean
from zoneinfo import ZoneInfo

MAX_ROWS = max(1, min(200_000, int(os.environ.get("RETAIL_MAX_ROWS", "200000"))))
MAX_CELLS = max(1, min(1_500_000, int(os.environ.get("RETAIL_MAX_CELLS", "1500000"))))
MAX_PRODUCTS = max(1, min(500, int(os.environ.get("RETAIL_MAX_PRODUCTS", "500"))))
MAX_DAYS = 3653
MAX_GRID = max(1, min(250_000, int(os.environ.get("RETAIL_MAX_GRID", "250000"))))
ALIASES = {
    "date": ["date", "sales_date", "order_date", "invoicedate"],
    "product_id": ["product_id", "sku", "item code", "stockcode", "item_id"],
    "product_name": ["product_name", "product", "description", "item_name"],
    "units": ["units_sold", "quantity", "units", "qty"],
    "event_id": ["event_id", "line_id"],
    "event_type": ["event_type", "transaction_type"],
    "store_id": ["store_id", "location_id"],
    "date_status": ["date_status", "observation_status"],
}


class DataError(ValueError):
    pass


def read_csv(raw):
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise DataError("Save the file as UTF-8 CSV, then upload it again.")
    if "\x00" in text:
        raise DataError("This is not a text CSV file.")
    try:
        delimiter = csv.Sniffer().sniff(text[:32768], delimiters=",;\t|").delimiter
    except csv.Error:
        delimiter = ","
    try:
        reader = csv.reader(io.StringIO(text), delimiter=delimiter, strict=True)
        headers = [h.strip() for h in next(reader)]
        if not headers or any(not h for h in headers) or len(headers) > 4000:
            raise DataError(
                "CSV headers are empty or exceed the supported column limit."
            )
        if len(set(h.casefold() for h in headers)) != len(headers):
            raise DataError(
                "Duplicate column headers found. Give each column a unique name."
            )
        rows = []
        for row in reader:
            if not row or all(not c.strip() for c in row):
                continue
            if len(row) != len(headers):
                raise DataError(
                    f"Row {reader.line_num} has a different number of cells from the header."
                )
            if any(len(c) > 4000 for c in row):
                raise DataError(
                    "A cell exceeds 4,000 characters. Remove long notes before uploading."
                )
            rows.append(dict(zip(headers, (v.strip() for v in row))))
            if len(rows) > MAX_ROWS:
                raise DataError(
                    f"This file has more than {MAX_ROWS:,} sales records. Export fewer products and upload again. Keep each product’s sales history together."
                )
            if len(rows) * len(headers) > MAX_CELLS:
                raise DataError(
                    "This file contains too much spreadsheet data. Remove unnecessary columns or export fewer products, then upload again. Keep each product’s sales history together."
                )
        if not rows:
            raise DataError("The CSV contains headers but no data.")
        return headers, rows, delimiter
    except (csv.Error, StopIteration):
        raise DataError(
            "The CSV could not be read. Check quotes, delimiters and headers."
        )


def inspect_csv(raw):
    headers, rows, delimiter = read_csv(raw)
    mapping = {}
    for field, aliases in ALIASES.items():
        matches = [h for h in headers if h.casefold() in aliases]
        if len(matches) == 1:
            mapping[field] = matches[0]
    wide = sum(bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}", h)) for h in headers) > 1
    date_values = (
        [h for h in headers if re.fullmatch(r"\d{4}-\d{2}-\d{2}", h)]
        if wide
        else [r.get(mapping.get("date", ""), "") for r in rows]
    )
    iso_dates = sorted(v for v in date_values if re.fullmatch(r"\d{4}-\d{2}-\d{2}", v))
    return {
        "suggested_range": [iso_dates[0], iso_dates[-1]] if iso_dates else None,
        "headers": headers,
        "row_count": len(rows),
        "preview": rows[:8],
        "delimiter": delimiter,
        "suggested_mapping": mapping,
        "suggested_layout": "wide"
        if wide
        else "transactions"
        if "event_type" in mapping
        else "daily",
    }


def parse_date(value, config):
    value = str(value).strip()
    if not value:
        raise DataError("A date is missing.")
    if "T" in value or re.search(r"\d \d\d:", value):
        if not config.get("timezone"):
            raise DataError("Timestamp rows need a confirmed store timezone.")
        try:
            tz = ZoneInfo(config["timezone"])
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return (dt.astimezone(tz) if dt.tzinfo else dt).date()
        except (ValueError, KeyError):
            raise DataError(
                "Timestamp or store timezone is invalid. Use ISO timestamps and an IANA timezone."
            )
    formats = {"ISO": "%Y-%m-%d", "MDY": "%m/%d/%Y", "DMY": "%d/%m/%Y"}
    try:
        return datetime.strptime(
            value, formats[config.get("date_format", "ISO")]
        ).date()
    except (ValueError, KeyError):
        raise DataError(
            "A date does not match the chosen date format. Confirm month/day order."
        )


def units(value, config):
    value = str(value).strip()
    if config.get("number_format", "dot") == "comma":
        if not re.fullmatch(r"[+-]?\d+(,\d+)?", value):
            raise DataError(
                "A quantity is missing or invalid. Remove thousands separators."
            )
        value = value.replace(",", ".")
    elif not re.fullmatch(r"[+-]?\d+(\.\d+)?", value):
        raise DataError(
            "A quantity is missing or invalid. Remove thousands separators."
        )
    try:
        n = Decimal(value)
        if not n.is_finite() or n != n.to_integral_value() or abs(n) > 1_000_000_000:
            raise DataError(
                "Quantities must be whole units within the supported range."
            )
        return int(n)
    except InvalidOperation:
        raise DataError("A quantity is invalid.")


def normalize(raw, config, progress=lambda *_: None):
    headers, rows, _ = read_csv(raw)
    mapping = config.get("mapping", {})
    layout = config.get("layout", "daily")
    if layout not in ("daily", "transactions", "wide"):
        raise DataError("Choose a supported CSV layout.")
    mapped = [v for v in mapping.values() if v]
    if len(mapped) != len(set(mapped)) or any(v not in headers for v in mapped):
        raise DataError(
            "Assign each source column once, using only headers from this file."
        )
    required = ["product_id"] + ([] if layout == "wide" else ["date", "units"])
    if any(not mapping.get(field) for field in required):
        raise DataError(
            "Map product ID, date and units before continuing (date columns for wide files)."
        )
    if str(mapping.get("units", "")).strip().casefold().replace(" ", "_") in (
        "net_units",
        "net_sales",
        "net_quantity",
    ):
        raise DataError(
            "The selected column is labelled net sales. Provide completed gross-unit sales and separate returns; net values cannot be reconstructed."
        )
    if config.get("quantity_basis") == "positive_invoice_units_proxy":
        if not config.get("demo_proxy_confirmed"):
            raise DataError(
                "Confirm the public demo is an invoice-units proxy, not verified completed sales."
            )
    elif not config.get("gross_sales_confirmed"):
        raise DataError(
            "Confirm that quantities represent completed gross sales, not net sales."
        )
    if not config.get("coverage_confirmed"):
        raise DataError(
            "Confirm the complete date range and that the selected products were active throughout it."
        )
    try:
        start, end = (
            date.fromisoformat(config["coverage_start"]),
            date.fromisoformat(config["coverage_end"]),
        )
    except (KeyError, ValueError):
        raise DataError(
            "Enter the first and last complete sales dates in YYYY-MM-DD format."
        )
    days = (end - start).days + 1
    if not 1 <= days <= MAX_DAYS:
        raise DataError("Coverage must span 1–3,653 days.")
    if end >= datetime.now(ZoneInfo(config.get("timezone") or "Etc/UTC")).date():
        raise DataError(
            "The last complete sales date must be before today in the store timezone."
        )
    value = lambda row, field: row.get(mapping.get(field, ""), "")
    stores = {value(r, "store_id") for r in rows if value(r, "store_id")}
    selected = config.get("store_id", "").strip()
    if len(stores) > 1 and not selected:
        raise DataError(
            "This file has multiple stores. Enter the exact store ID to analyze one location."
        )
    if selected and stores and selected not in stores:
        raise DataError("The selected store ID is not in this file.")
    coverage = {}
    for row in config.get("coverage_rows", []):
        pid = row.get("product_id", "")
        if not pid or pid in coverage:
            raise DataError("Coverage product IDs must be present and unique.")
        try:
            a = date.fromisoformat(row["active_from"])
            b = date.fromisoformat(row.get("active_to") or str(end))
        except (ValueError, KeyError):
            raise DataError("Coverage dates must use YYYY-MM-DD.")
        if a > b or a > end or b < start:
            raise DataError(
                "Product active window does not intersect the selected range."
            )
        coverage[pid] = (max(a, start), min(b, end))
    date_statuses = {}
    for row in config.get("date_status_rows", []):
        try:
            d = date.fromisoformat(row["date"])
        except (ValueError, KeyError):
            raise DataError("Supporting status dates must use YYYY-MM-DD.")
        status = row.get("date_status", "")
        if status not in (
            "observed",
            "zero_confirmed",
            "closed",
            "unknown",
            "censored_stockout",
        ):
            raise DataError("Unsupported supporting date status.")
        key = (row.get("product_id", ""), d)
        if not key[0] or key in date_statuses or not start <= d <= end:
            raise DataError(
                "Supporting date status has a missing, duplicate or out-of-range key."
            )
        date_statuses[key] = status
    issues, blocked, data, names, events = [], set(), {}, {}, {}
    counts = defaultdict(int)
    global_block = False

    def issue(code, message, pid="", row=None, blocking=True):
        nonlocal global_block
        counts[code] += 1
        if len(issues) < 150:
            issues.append(
                {
                    "code": code,
                    "message": message,
                    "product_id": pid,
                    "row": row,
                    "blocking": blocking,
                }
            )
        if blocking:
            if pid:
                blocked.add(pid)
            else:
                global_block = True

    wide_cols = [h for h in headers if h not in mapped] if layout == "wide" else []
    if layout == "wide":
        for h in wide_cols:
            parse_date(h, config)
        if not wide_cols:
            raise DataError("No date columns found for this wide file.")
    for index, row in enumerate(rows, 2):
        if index % 1000 == 0:
            progress("Checking sales rows", index - 1, len(rows))
        if selected and stores and value(row, "store_id") != selected:
            counts["omitted_other_store_rows"] += 1
            continue
        pid = value(row, "product_id")
        if not pid:
            issue("missing_product", "A row has no stable product ID.", row=index)
            continue
        if pid in config.get("exclude_product_ids", []):
            counts["explicitly_excluded_rows"] += 1
            continue
        if pid.casefold() in ("total", "subtotal", "grand total", "grand_total"):
            issue(
                "subtotal_row",
                "Possible subtotal row. Explicitly exclude this ID or correct the source.",
                row=index,
            )
            continue
        if len(pid) > 120:
            issue(
                "invalid_product",
                "Product IDs must be at most 120 characters.",
                row=index,
            )
            continue
        label = value(row, "product_name")[:200] or pid
        if pid in names and names[pid] != label:
            issue(
                "product_rename",
                "One product ID has different names. Confirm it is a rename, not different variants.",
                pid,
                index,
                blocking=not config.get("allow_product_renames"),
            )
        names[pid] = label
        if len(names) > MAX_PRODUCTS or len(names) * days > MAX_GRID:
            raise DataError(
                f"This server supports at most {MAX_PRODUCTS:,} products and {MAX_GRID:,} product-days per analysis."
            )
        for raw_day, raw_units in (
            [(h, row[h]) for h in wide_cols]
            if layout == "wide"
            else [(value(row, "date"), value(row, "units"))]
        ):
            try:
                day = parse_date(raw_day, config)
                if not start <= day <= end:
                    raise DataError(
                        "A row falls outside the confirmed coverage. Correct the range or export."
                    )
                if pid in coverage and not coverage[pid][0] <= day <= coverage[pid][1]:
                    raise DataError(
                        "Sales occur outside this product’s active window. Correct the coverage file."
                    )
                if layout == "wide" and not str(raw_units).strip():
                    if (pid, day) in data:
                        raise DataError(
                            "Duplicate daily product/date key in wide layout."
                        )
                    data[pid, day] = (None, "unknown")
                    continue
                amount = units(raw_units, config)
                event = value(row, "event_type").lower()
                event = config.get("event_labels", {}).get(event, event)
                status = value(row, "date_status").lower() or "observed"
                status = {
                    "stockout": "censored_stockout",
                    "zero": "zero_confirmed",
                }.get(status, status)
                if status not in (
                    "observed",
                    "zero_confirmed",
                    "closed",
                    "unknown",
                    "censored_stockout",
                ):
                    raise DataError(
                        "Unknown observation status. Map it to the supported status vocabulary."
                    )
                if status in ("zero_confirmed", "closed") and amount != 0:
                    raise DataError(
                        "Closed or zero-confirmed days cannot have positive sales."
                    )
                if layout == "transactions":
                    if event not in ("", "sale", "return", "cancellation"):
                        raise DataError(
                            "Unrecognized event type. Use sale, return or cancellation."
                        )
                    eid = value(row, "event_id")
                    signature = (pid, str(day), amount, event, status)
                    if eid and eid in events:
                        previous = events[eid]
                        if previous != signature:
                            blocked.add(previous[0])
                            raise DataError(
                                "The same event ID has conflicting values. Fix it in the source."
                            )
                        if not config.get("deduplicate_events"):
                            raise DataError(
                                "Repeated identical event IDs found. Confirm removal of exact repeats."
                            )
                        counts["duplicate_events_removed"] += 1
                        continue
                    if eid:
                        events[eid] = signature
                    if event in ("return", "cancellation"):
                        counts["excluded_" + event] += 1
                        counts[event + "_units"] += abs(amount)
                        continue
                if amount < 0:
                    raise DataError(
                        "Negative sales are unclassified. Separate returns and cancellations first."
                    )
                key = (pid, day)
                if key in data and layout != "transactions":
                    raise DataError(
                        "Duplicate daily product/date key. Resolve it in the source; rows were not summed."
                    )
                if layout == "transactions" and key in data:
                    old_amount, old_status = data[key]
                    if old_amount is None:
                        raise DataError(
                            "Conflicting unknown and observed transactions."
                        )
                    amount += old_amount
                    if old_status != "observed":
                        status = old_status
                data[key] = (amount, status)
            except DataError as exc:
                issue("invalid_row", str(exc), pid, index)
    if not names:
        raise DataError("No product rows remain for the selected store.")
    unknown_support = (set(coverage) | {k[0] for k in date_statuses}) - set(names)
    if unknown_support:
        raise DataError(
            "Supporting files contain unmatched product IDs: "
            + ", ".join(sorted(unknown_support)[:5])
        )
    if coverage and set(names) - set(coverage):
        raise DataError("Coverage file must include each product in this import.")
    products, canonical = [], []
    for pid in sorted(names):
        series, missing, censored = [], 0, 0
        product_start, product_end = coverage.get(pid, (start, end))
        product_days = (product_end - product_start).days + 1
        if any(
            key_pid == pid and not product_start <= key_day <= product_end
            for key_pid, key_day in date_statuses
        ):
            issue(
                "status_outside_active_window",
                "A date-status row is outside this product's active dates.",
                pid,
            )
        for offset in range(product_days):
            day = product_start + timedelta(days=offset)
            found = data.get((pid, day))
            if found is None:
                found = (
                    (0, "zero_confirmed")
                    if config.get("missing_days_zero")
                    else (None, "unknown")
                )
            amount, status = found
            if (pid, day) in date_statuses:
                override = date_statuses[pid, day]
                if override in ("closed", "zero_confirmed"):
                    if amount not in (None, 0):
                        issue(
                            "status_conflict",
                            "Positive sales conflict with closed/zero status.",
                            pid,
                        )
                    else:
                        amount = 0
                if override == "observed" and amount is None:
                    override = "unknown"
                status = override
            if status == "unknown":
                missing += 1
            if status == "censored_stockout":
                censored += 1
            target = (
                amount if status in ("observed", "closed", "zero_confirmed") else None
            )
            series.append(target)
            canonical.append(
                {
                    "date": str(day),
                    "product_id": pid,
                    "product_name": names[pid],
                    "units_sold": amount,
                    "observation_status": status,
                }
            )
        if missing:
            issue(
                "unknown_dates",
                f"{missing} dates are unknown. Supply daily coverage or explicitly confirm zero sales.",
                pid,
            )
        if censored:
            issue(
                "stockout_dates",
                f"{censored} dates were affected by stockouts. Sales understate demand.",
                pid,
            )
        usable = sum(v is not None for v in series)
        total = sum(v for v in series if v is not None)
        state = (
            "needs_review"
            if global_block or pid in blocked
            else "summary_only"
            if product_days < 56 or total == 0
            else "limited"
            if product_days < 168
            else "ready"
        )
        if product_days < 56:
            issue(
                "short_history",
                "At least 56 complete daily observations are needed for a baseline.",
                pid,
                blocking=False,
            )
        if total == 0:
            issue(
                "all_zero",
                "No positive sales history. Forecast and order recommendation withheld.",
                pid,
                blocking=False,
            )
        positive = [v for v in series if v is not None and v > 0]
        if positive and max(positive) > mean(positive) * 10:
            issue(
                "outlier",
                "Unusually large sales day found. Retained without alteration; inspect source data.",
                pid,
                blocking=False,
            )
        if product_end < end:
            state = "summary_only"
            issue(
                "inactive_product",
                "Product active period ended. No future sales or reorder advice.",
                pid,
                blocking=False,
            )
        products.append(
            {
                "product_id": pid,
                "name": names[pid],
                "status": state,
                "days": product_days,
                "active_from": str(product_start),
                "active_to": str(product_end),
                "usable_days": usable,
                "total_units": total,
                "missing_days": missing,
                "stockout_days": censored,
                "series": series,
            }
        )
    return {
        "products": products,
        "issues": issues,
        "issue_counts": dict(counts),
        "global_block": global_block,
        "rows": len(rows),
        "coverage_start": str(start),
        "coverage_end": str(end),
        "store_id": selected or next(iter(stores), "single-store"),
        "config": {
            k: v
            for k, v in config.items()
            if k not in ("coverage_rows", "date_status_rows")
        },
        "canonical": canonical,
        "eligible_products": sum(p["status"] in ("ready", "limited") for p in products),
    }


def predict(y, method, horizon=28):
    if method == "seasonal_naive":
        return [float(y[-7 + i % 7]) for i in range(horizon)]
    if method == "mean_56":
        return [mean(y[-56:])] * horizon
    if method == "exponential_level":
        level = float(y[0])
        for v in y[1:]:
            level = 0.15 * v + 0.85 * level
        return [level] * horizon
    if method == "mean_28":
        return [mean(y[-28:])] * horizon
    if method == "weekday_mean":
        return [mean(y[-7 + i % 7 :: -7][:8]) for i in range(horizon)]
    if method == "croston_sba":
        first = next(i for i, v in enumerate(y) if v > 0)
        size, interval, gap = float(y[first]), float(first + 1), 1
        for v in y[first + 1 :]:
            if v > 0:
                size += 0.1 * (v - size)
                interval += 0.1 * (gap - interval)
                gap = 1
            else:
                gap += 1
        return [0.95 * size / interval] * horizon
    raise DataError("Unknown forecasting method.")


def metrics(actual, predicted):
    errors = [p - a for a, p in zip(actual, predicted)]
    absolute = sum(abs(e) for e in errors)
    total = sum(actual)
    return {
        "mae": absolute / len(actual),
        "wape": absolute / total if total else None,
        "bias_units_per_day": mean(errors),
        "total_absolute_error": abs(sum(predicted) - total),
        "actual_total": total,
        "predicted_total": sum(predicted),
    }


def forecast(report, progress=lambda *_: None):
    if report["global_block"]:
        raise DataError("Resolve file-wide data issues before forecasting.")
    output = []
    start = date.fromisoformat(report["coverage_end"]) + timedelta(days=1)
    for i, p in enumerate(report["products"]):
        progress("Testing and forecasting products", i, len(report["products"]))
        item = {k: v for k, v in p.items() if k != "series"}
        item["history"] = [
            {
                "date": str(
                    date.fromisoformat(p.get("active_to", report["coverage_end"]))
                    - timedelta(days=len(p["series"]) - 1 - j)
                ),
                "units": v,
            }
            for j, v in enumerate(p["series"])
        ][-56:]
        item.update(
            {
                "forecast": [],
                "evaluation": None,
                "selection": [],
                "range": None,
                "range_reason": "Not enough independent forecast errors to establish a calibrated prediction range.",
            }
        )
        if p["status"] not in ("ready", "limited"):
            output.append(item)
            continue
        y = p["series"]
        n = len(y)
        method = "seasonal_naive"
        if n >= 168:
            candidates = [
                "seasonal_naive",
                "mean_28",
                "weekday_mean",
                "croston_sba",
                "mean_56",
                "exponential_level",
            ]
            for candidate in candidates:
                scores = []
                for cutoff in (
                    [n - 364, n - 336, n - 308]
                    if n >= 420
                    else [n - 112, n - 84, n - 56]
                ):
                    train = y[:cutoff]
                    pred = predict(train, candidate) if sum(train) > 0 else [0.0] * 28
                    scores.append(metrics(y[cutoff : cutoff + 28], pred)["mae"])
                item["selection"].append(
                    {"method": candidate, "mean_mae": mean(scores), "windows": 3}
                )
            method = min(item["selection"], key=lambda v: v["mean_mae"])["method"]
        tests = []
        cutoffs = (
            [n - 28]
            if n >= 168
            else list(range(n - 28 * max(0, (n - 56) // 28), n, 28))
        )
        for cutoff in cutoffs:
            actual = y[cutoff : cutoff + 28]
            chosen = predict(y[:cutoff], method) if sum(y[:cutoff]) > 0 else [0.0] * 28
            baseline = predict(y[:cutoff], "seasonal_naive")
            tests.append(
                {
                    "start": str(start - timedelta(days=n - cutoff)),
                    "end": str(start - timedelta(days=n - cutoff - 27)),
                    "training_days": cutoff,
                    "model": metrics(actual, chosen),
                    "baseline": metrics(actual, baseline),
                }
            )
        item["evaluation"] = (
            {
                "kind": "untouched_final_holdout"
                if n >= 168
                else "limited_baseline_test",
                "windows": tests,
            }
            if tests
            else None
        )
        item["method"] = method
        item["forecast"] = [
            {"date": str(start + timedelta(days=d)), "units": round(v, 6)}
            for d, v in enumerate(predict(y, method))
        ]
        item["forecast_total"] = sum(v["units"] for v in item["forecast"])
        if n >= 420:
            errors = []
            totals = []
            for cutoff in range(n - 280, n - 28, 28):
                prediction = (
                    predict(y[:cutoff], method) if sum(y[:cutoff]) else [0.0] * 28
                )
                actual = y[cutoff : cutoff + 28]
                errors.append([abs(a - b) for a, b in zip(actual, prediction)])
                totals.append(abs(sum(actual) - sum(prediction)))
            widths = [max(row[h] for row in errors) for h in range(28)]
            last_prediction = predict(y[:-28], method) if sum(y[:-28]) else [0.0] * 28
            covered = sum(
                abs(a - b) <= w for a, b, w in zip(y[-28:], last_prediction, widths)
            )
            item["range"] = {
                "nominal_coverage": 0.9,
                "calibration_windows": len(errors),
                "evaluation_windows": 1,
                "evaluation_daily_coverage": covered / 28,
                "evaluation_total_covered": abs(sum(y[-28:]) - sum(last_prediction))
                <= max(totals),
                "daily": [
                    {
                        "date": v["date"],
                        "lower": max(0, v["units"] - widths[h]),
                        "upper": v["units"] + widths[h],
                    }
                    for h, v in enumerate(item["forecast"])
                ],
                "total": {
                    "lower": max(0, item["forecast_total"] - max(totals)),
                    "upper": item["forecast_total"] + max(totals),
                },
                "method": "90% split-conformal absolute residual bands; rolling nonoverlapping calibration windows; temporal dependence means nominal coverage is not guaranteed.",
            }
            item["range_reason"] = (
                "Range calibrated on 9 separate 28-day periods after method selection, checked on one final period. The total range is calibrated separately, not summed from daily bounds."
            )

        last = tests[-1] if tests else None
        tested_wape = last["model"]["wape"] if last else None
        acceptable = (
            bool(last)
            and tested_wape is not None
            and tested_wape <= 0.5
            and last["model"]["mae"] <= last["baseline"]["mae"] + 1e-9
        )
        item["inventory_eligible"] = acceptable
        item["forecast_warning"] = (
            None
            if acceptable
            else "Inventory recommendation withheld: historical testing is missing, undefined, above the provisional 50% WAPE error limit, or worse than the weekly baseline. This limit is an application safeguard, not a calibrated reliability threshold."
        )
        output.append(item)
    return {
        "engine_revision": "1.1.0",
        "horizon_days": 28,
        "forecast_start": str(start),
        "forecast_end": str(start + timedelta(days=27)),
        "products": output,
        "quality": {
            k: v for k, v in report.items() if k not in ("canonical", "products")
        },
        "notice": "Forecasts estimate sales under the supplied coverage assumptions, not unconstrained demand. Past test error is not future accuracy.",
    }


def inventory(daily, config):
    def integer(name, minimum=0, default=None):
        v = config.get(name, default)
        if type(v) is not int or not minimum <= v <= 1_000_000_000:
            raise DataError(f"{name} must be a whole number of at least {minimum}.")
        return v

    if not config.get("confirmed"):
        raise DataError("Confirm the inventory snapshot and incoming orders first.")
    stock = integer("stock")
    lead = integer("lead_days", 1)
    review = integer("review_days", 1)
    buffer = integer("buffer_days")
    pack = integer("pack_size", 1)
    moq = integer("minimum_order")
    if lead + review + buffer > len(daily):
        raise DataError(
            "Lead time + review period + buffer must fit within the 28-day forecast."
        )
    start = date.fromisoformat(daily[0]["date"])
    if config.get("snapshot_date") != str(start):
        raise DataError(
            "Inventory must be available at the start of the forecast date."
        )
    mode = config.get("mode")
    if mode not in ("historical_replay", "current"):
        raise DataError("Choose current planning or historical replay.")
    today = datetime.now(ZoneInfo(config.get("timezone") or "Etc/UTC")).date()
    if mode == "current" and start != today:
        raise DataError(
            "Current planning requires a forecast starting today. Use historical replay for older data."
        )
    receipts = defaultdict(int)
    seen = set()
    late = 0
    for order in config.get("incoming", []):
        eid = order.get("id", "").strip()
        if not eid or eid in seen:
            raise DataError("Incoming order IDs must be present and unique.")
        seen.add(eid)
        state = order.get("status", "open")
        if state not in ("open", "received", "cancelled"):
            raise DataError("Incoming status must be open, received or cancelled.")
        if state != "open":
            continue
        qty = order.get("units")
        if type(qty) is not int or not 0 < qty <= 1_000_000_000:
            raise DataError("Incoming quantities must be positive whole units.")
        try:
            day = date.fromisoformat(order["date"])
        except (KeyError, ValueError):
            raise DataError("An incoming order date is invalid.")
        offset = (day - start).days
        if offset < 0:
            raise DataError(
                "An incoming order is overdue. Update its receipt status or due date."
            )
        if offset >= 28:
            late += qty
        else:
            receipts[offset] += qty
    pre_unmet = 0.0
    first = None
    available = float(stock)
    for d in range(lead):
        available += receipts[d]
        demand = daily[d]["units"]
        shortage = max(0, demand - available)
        if shortage and first is None:
            first = daily[d]["date"]
        pre_unmet += shortage
        available = max(0, available - demand)
    available += receipts[lead]
    arrival_stock = available
    cumulative = 0.0
    prefix = 0.0
    period = 0.0
    for d in range(lead, lead + review):
        if d > lead:
            cumulative -= receipts[d]
        cumulative += daily[d]["units"]
        period += daily[d]["units"]
        prefix = max(prefix, cumulative - arrival_stock)
    buffer_units = sum(
        x["units"] for x in daily[lead + review : lead + review + buffer]
    )
    raw = max(0, prefix, cumulative + buffer_units - arrival_stock)
    order = math.ceil(max(raw, moq) / pack) * pack if raw > 1e-9 else 0
    available = arrival_stock + order
    for d in range(lead, lead + review):
        if d > lead:
            available += receipts[d]
        available = max(0, available - daily[d]["units"])
    projection = []
    running = float(stock)
    for d in range(28):
        opening = running
        planned_receipt = order if d == lead else 0
        running += receipts[d] + planned_receipt
        demand = daily[d]["units"]
        unmet = max(0, demand - running)
        running = max(0, running - demand)
        projection.append(
            {
                "date": daily[d]["date"],
                "opening_units": opening,
                "incoming_units": receipts[d],
                "proposed_receipt_units": planned_receipt,
                "forecast_units": demand,
                "unmet_units": unmet,
                "closing_units": running,
            }
        )
    return {
        "daily_stock": projection,
        "planning_date": str(start),
        "arrival_date": str(start + timedelta(days=lead)),
        "pre_arrival_unmet_units": pre_unmet,
        "first_shortfall_date": first,
        "stock_before_new_order_on_arrival": arrival_stock,
        "protection_units": period,
        "buffer_units": buffer_units,
        "raw_order_units": raw,
        "suggested_order_units": order,
        "end_protection_stock_with_order": available,
        "beyond_horizon_incoming_units": late,
        "mode": mode,
        "assumptions": config,
        "notice": "Lost-sales estimate. Buffer is a user assumption, not a statistical service-level guarantee. No order has been placed.",
    }
