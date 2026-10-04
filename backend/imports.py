"""Exact-key, bounded supporting data joins. No fuzzy product matching."""

from .domain import read_csv, DataError, units


def supporting(raw, kind):
    headers, rows, _ = read_csv(raw)
    required = {
        "coverage": {"product_id", "active_from", "active_to"},
        "date_status": {"product_id", "date", "date_status"},
        "inventory": {
            "product_id",
            "available_units",
            "as_of_date",
            "lead_time_days",
            "pack_size",
            "minimum_order_units",
        },
        "incoming": {"incoming_line_id", "product_id", "due_date", "incoming_units"},
    }[kind]
    if not required.issubset(headers):
        raise DataError(
            "Use the "
            + kind
            + " template. Missing columns: "
            + ", ".join(sorted(required - set(headers)))
        )
    if len(rows) > 10000:
        raise DataError("Supporting files are limited to 10,000 rows.")
    return [
        {k: r[k] for k in required | ({"status"} if "status" in headers else set())}
        for r in rows
    ]


def compare(previous, current):
    def index(report):
        return {
            (r["product_id"], r["date"]): (r["units_sold"], r["observation_status"])
            for r in report["canonical"]
        }

    a, b = index(previous), index(current)
    both = set(a) & set(b)
    changed = [
        {
            "product_id": k[0],
            "date": k[1],
            "previous_units": a[k][0],
            "new_units": b[k][0],
        }
        for k in sorted(both)
        if a[k] != b[k]
    ]
    return {
        "identical_keys": sum(a[k] == b[k] for k in both),
        "changed_keys": len(changed),
        "new_keys": len(set(b) - set(a)),
        "removed_keys": len(set(a) - set(b)),
        "changes": changed[:100],
        "action": "This is a separate replacement analysis, never an automatic append. Previous results remain in history.",
    }


def inventory_rows(stock_rows, incoming_rows, products):
    allowed = {p["product_id"] for p in products}
    plans = {}
    seen = set()
    for row in stock_rows:
        pid = row["product_id"]
        if pid not in allowed:
            raise DataError("Inventory has unmatched product ID: " + pid)
        if pid in plans:
            raise DataError("Inventory has duplicate product ID: " + pid)
        plans[pid] = {
            "product_id": pid,
            "stock": units(row["available_units"], {}),
            "snapshot_date": row["as_of_date"],
            "lead_days": units(row["lead_time_days"], {}),
            "review_days": 7,
            "buffer_days": 2,
            "pack_size": units(row["pack_size"], {}),
            "minimum_order": units(row["minimum_order_units"], {}),
            "mode": "historical_replay",
            "confirmed": False,
            "incoming": [],
        }
    for row in incoming_rows:
        pid = row["product_id"]
        eid = row["incoming_line_id"]
        if not eid or eid in seen:
            raise DataError(
                "Incoming line IDs must be present and unique. Resolve repeated or conflicting lines."
            )
        seen.add(eid)
        if pid not in allowed:
            raise DataError("Incoming stock has unmatched product ID: " + pid)
        if pid not in plans:
            raise DataError(
                "Incoming stock requires a matching inventory snapshot for " + pid
            )
        plans[pid]["incoming"].append(
            {
                "id": eid,
                "date": row["due_date"],
                "units": units(row["incoming_units"], {}),
                "status": row.get("status", "open"),
            }
        )
    return plans
