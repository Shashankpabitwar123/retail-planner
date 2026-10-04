"""Deterministic onboarding: infer supported formats; ask only unresolved questions."""

import hashlib
import re
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from .domain import read_csv, inspect_csv, parse_date, DataError, ALIASES


def guide(raw, answers, timezone="Etc/UTC"):
    if (
        not isinstance(answers, dict)
        or len(answers) > 24
        or any(
            not isinstance(k, str) or not isinstance(v, str) or len(v) > 120
            for k, v in answers.items()
        )
    ):
        raise DataError("Please choose an answer from the available options.")
    headers, rows, _ = read_csv(raw)
    detected = inspect_csv(raw)
    cfg = dict(
        mapping={},
        layout=detected["suggested_layout"],
        date_format="ISO",
        number_format="dot",
        timezone="Etc/UTC",
        coverage_start="",
        coverage_end="",
        coverage_confirmed=False,
        gross_sales_confirmed=False,
        missing_days_zero=False,
        deduplicate_events=False,
        store_id="",
    )

    def question(key, title, detail, options, input_kind=None):
        return {
            "config": cfg,
            "question": {
                "id": key,
                "title": title,
                "detail": detail,
                "options": options,
                "input": input_kind,
            },
            "ready": False,
        }

    def option(value, label, hint=""):
        return {"value": value, "label": label, "hint": hint}

    def choice(key, options):
        v = answers.get(key)
        if v is not None and v not in [x["value"] for x in options]:
            raise DataError(
                "That answer no longer matches this file. Start again with the current file."
            )
        return v

    def key(h):
        return re.sub(r"[^a-z0-9]", "", h.casefold())

    aliases = {k: {key(x) for x in v} for k, v in ALIASES.items()}
    aliases["date"] |= {"transactiondate", "saledate", "solddate", "soldon", "salesday"}
    aliases["product_id"] |= {"productcode", "itemcode", "itemsku"}
    aliases["units"] |= {
        "salesquantity",
        "soldquantity",
        "quantitysold",
        "grossunits",
        "grossunitssold",
    }
    for field, names in aliases.items():
        matches = [h for h in headers if key(h) in names]
        if len(matches) == 1:
            cfg["mapping"][field] = matches[0]
    # A descriptive dish/item name can identify products when no code is present.
    if "product_id" not in cfg["mapping"]:
        names = [h for h in headers if key(h) in {"dishname", "itemname", "productname"}]
        if len(names) == 1:
            cfg["mapping"]["product_id"] = names[0]
            cfg["mapping"]["product_name"] = names[0]
    wide = detected["suggested_layout"] == "wide"
    for field, title in [
        ("product_id", "Which heading contains the item names or codes?"),
        ("date", "Which heading tells us when the sale happened?"),
        ("units", "Which heading tells us how many items were sold?"),
    ]:
        if wide and field in ("date", "units"):
            continue
        if field not in cfg["mapping"]:
            available = [h for h in headers if h not in cfg["mapping"].values()]
            if field == "units":
                available = [h for h in available if key(h) not in {"price", "amount", "revenue", "totalsales", "salesamount", "totalrevenue"}]
            opts = [
                option(
                    h,
                    h,
                    "For example: "
                    + ", ".join(dict.fromkeys(r[h] for r in rows[:4]))[:90],
                )
                for h in available
            ]
            opts.append(
                option(
                    "__missing__",
                    "My file doesn’t have this",
                    "Upload a sales export with product codes, dates and quantities.",
                )
            )
            answer = choice("column_" + field, opts)
            if answer == "__missing__":
                return {
                    "config": cfg,
                    "ready": False,
                    "blocked": "This file needs product codes, sale dates and quantities. Download the example to see what to include.",
                }
            if not answer:
                return question(
                    "column_" + field,
                    title,
                    "Choose the heading that matches. The examples below come from your file.",
                    opts,
                )
            cfg["mapping"][field] = answer
    if key(cfg["mapping"].get("units", "")) in {"totalsales", "revenue", "salesamount", "totalrevenue", "price", "amount"}:
        options = [option(h, h) for h in headers if h not in cfg["mapping"].values() and key(h) not in {"totalsales", "revenue", "salesamount", "totalrevenue", "price", "amount"}]
        options.append(option("__missing__", "I don’t have item quantities"))
        selected = choice("quantity_column", options)
        if selected == "__missing__":
            return {"config": cfg, "ready": False, "blocked": "Stock planning needs the number of items sold, not sales revenue or customer visits. Export item quantities and upload again."}
        if not selected:
            return question("quantity_column", "Which column counts items sold?", "The selected column looks like money. Choose item quantities, not revenue. Use customer counts only if each count means one item sold.", options)
        cfg["mapping"]["units"] = selected
    units_header = cfg["mapping"].get("units", "")
    if any(word in key(units_header) for word in ("customer", "guest", "visitor", "people")):
        opts = [option("items", "Items or portions sold", "Each count means one item sold."), option("people", "People served", "A person may buy more than one item."), option("unsure", "I’m not sure")]
        meaning = choice("quantity_meaning", opts)
        if not meaning:
            return question("quantity_meaning", f'What does “{units_header}” count?', "Stock planning needs items sold. Customer visits alone cannot tell us how much stock was used.", opts)
        if meaning != "items":
            return {"config": cfg, "ready": False, "blocked": "We need the number of items or portions sold for each product. Go back to choose that heading, or upload a file with item quantities."}
    if "event_type" in cfg["mapping"] or "event_id" in cfg["mapping"]:
        cfg["layout"] = "transactions"
    dates = (
        [h for h in headers if re.fullmatch(r"\d{4}-\d{2}-\d{2}", h)]
        if wide
        else [r[cfg["mapping"]["date"]] for r in rows]
    )
    timestamps = any("T" in d or re.search(r"\d \d\d:", d) for d in dates)
    if timestamps:
        zone = answers.get("timezone")
        if not zone:
            return question(
                "timezone",
                "What time zone does this store use?",
                "This file includes times. The store’s time zone keeps late-night sales on the right day.",
                [],
                "timezone",
            )
        try:
            ZoneInfo(zone)
        except (ValueError, ZoneInfoNotFoundError):
            raise DataError("Choose a valid store time zone, such as America/New_York.")
        cfg["timezone"] = zone
    # Check every date, not only the first few preview rows.
    candidates = {}
    for fmt in ["ISO", "MDY", "DMY"]:
        try:
            candidates[fmt] = [
                parse_date(d, {**cfg, "date_format": fmt}) for d in dates
            ]
        except DataError:
            pass
    if not candidates:
        return {
            "config": cfg,
            "ready": False,
            "blocked": "Some sale dates could not be read. Use YYYY-MM-DD dates throughout the file, then upload it again.",
        }
    formats = list(candidates)
    if len(formats) > 1 and any(
        candidates[f] != candidates[formats[0]] for f in formats[1:]
    ):
        i = next(
            i for i in range(len(dates)) if len({candidates[f][i] for f in formats}) > 1
        )
        opts = [option(f, candidates[f][i].strftime("%B %d, %Y")) for f in formats]
        fmt = choice("dates", opts)
        if not fmt:
            return question(
                "dates",
                f"What does “{dates[i]}” mean?",
                "Both date orders are possible. Pick the one your store uses.",
                opts,
            )
    else:
        fmt = formats[0]
    cfg["date_format"] = fmt
    parsed = candidates[fmt]
    stores = (
        sorted(set(r[cfg["mapping"]["store_id"]] for r in rows))
        if "store_id" in cfg["mapping"]
        else []
    )
    if len(stores) > 1:
        if len(stores) > 100:
            return {
                "config": cfg,
                "ready": False,
                "blocked": "This file contains more than 100 stores. Export one store and upload it again.",
            }
        opts = [option(x, x or "(blank store code)") for x in stores if x]
        store = choice("store", opts)
        if not store:
            return question(
                "store",
                "Which store would you like to look at?",
                "We found sales from more than one store. We’ll use only the store you choose.",
                opts,
            )
        cfg["store_id"] = store
        if not wide:
            parsed = [
                d
                for r, d in zip(rows, parsed)
                if r[cfg["mapping"]["store_id"]] == store
            ]
    elif stores:
        cfg["store_id"] = stores[0]
    cfg["coverage_start"], cfg["coverage_end"] = str(min(parsed)), str(max(parsed))
    if not wide:
        quantity = cfg["mapping"]["units"]
        if key(quantity) in {"netunits", "netsales", "netquantity"}:
            return {
                "config": cfg,
                "ready": False,
                "blocked": "These quantities already subtract returns. Please export sold quantities and returns separately so we can calculate sales correctly.",
            }
        values = [r[quantity] for r in rows if r[quantity]]
        commas = [v for v in values if "," in v]
        if commas:
            opts = [
                option("comma", "A decimal point (for example, 12,0 means 12)"),
                option(
                    "thousands", "A thousands separator (for example, 1,000 means 1000)"
                ),
            ]
            sep = choice("numbers", opts)
            if not sep:
                return question(
                    "numbers",
                    f"How should we read “{commas[0][:30]}”?",
                    "We don’t want to mistake a decimal for thousands.",
                    opts,
                )
            if sep == "thousands":
                return {
                    "config": cfg,
                    "ready": False,
                    "blocked": "Please export quantities without thousands separators, then upload again.",
                }
            cfg["number_format"] = "comma"
        keys = [
            (str(d), r[cfg["mapping"]["product_id"]])
            for r, d in zip(rows, candidates[fmt])
            if not cfg["store_id"]
            or r[cfg["mapping"].get("store_id", "")] == cfg["store_id"]
        ]
        if cfg["layout"] == "daily" and len(set(keys)) < len(keys):
            opts = [
                option("transactions", "Each row is a separate sale"),
                option("daily", "Each row is a daily total"),
            ]
            layout = choice("rows", opts)
            if not layout:
                return question(
                    "rows",
                    "What does one row in this file represent?",
                    "Some products appear more than once on the same day. We need to know whether to add those rows together.",
                    opts,
                )
            cfg["layout"] = layout
    # Only byte-identical built-in fixtures can bypass unknowable business assumptions.
    sample_dir = Path(__file__).resolve().parent.parent / "samples"
    known = any(
        hashlib.sha256(raw).digest() == hashlib.sha256(p.read_bytes()).digest()
        for p in (
            sample_dir / n
            for n in [
                "01-daily.csv",
                "02-transactions.csv",
                "03-wide-dates.csv",
                "05-missing-period.csv",
                "11-short-history.csv",
            ]
        )
        if p.exists()
    )
    cfg["synthetic"] = known
    if not known:
        opts = [
            option(
                "yes",
                "Yes, this is the complete export",
                "All sales are included, returns are separate, and these products were available throughout this period.",
            ),
            option("unsure", "I’m not sure", "Show me what I need to check."),
        ]
        confirm = choice("complete", opts)
        if confirm == "unsure":
            return {
                "config": cfg,
                "ready": False,
                "blocked": "Export all sales for these dates, with sold quantities and returns separate. If a product launched later or was discontinued, add its dates under Import details. We’ll keep unknown days separate from zero sales.",
            }
        if not confirm:
            return question(
                "complete",
                "Is this the complete sales export?",
                f"We found sales from {cfg['coverage_start']} to {cfg['coverage_end']}. This is the one detail the file cannot tell us.",
                opts,
            )
    cfg["coverage_confirmed"] = True
    cfg["gross_sales_confirmed"] = True
    return {"config": cfg, "ready": True, "question": None}
