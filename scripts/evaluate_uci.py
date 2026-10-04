"""Offline evaluation, not an app throughput claim. Original source required locally."""

import csv
import hashlib
import json
import sys
import time
import zipfile
import xml.etree.ElementTree as ET
from collections import defaultdict, Counter
from datetime import datetime, timedelta, date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.domain import normalize, forecast, metrics

BASE = Path(__file__).resolve().parents[1]
SOURCE = Path(sys.argv[1])
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
IDS = {"22423", "84879", "85099B"}
START = date(2010, 12, 1)
CUTOFF = date(2011, 11, 10)
END = date(2011, 12, 8)
counts = Counter()
daily = defaultdict(int)
names = {}
started = time.perf_counter()
with zipfile.ZipFile(SOURCE) as z:
    strings = []
    with z.open("xl/sharedStrings.xml") as f:
        for _, el in ET.iterparse(f, events=("end",)):
            if el.tag == NS + "si":
                strings.append("".join(t.text or "" for t in el.iter(NS + "t")))
                el.clear()
    rels = {
        e.get("Id"): e.get("Target")
        for e in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    }
    sheets = ET.fromstring(z.read("xl/workbook.xml")).find(NS + "sheets")
    selected = next(s for s in sheets if s.get("name") == "Year 2010-2011")
    target = rels[
        selected.get(
            "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
        )
    ]
    target = target.lstrip("/") if target.startswith("/") else "xl/" + target
    with z.open(target) as f:
        for _, el in ET.iterparse(f, events=("end",)):
            if el.tag != NS + "row":
                continue
            values = {}
            for c in el.findall(NS + "c"):
                col = "".join(x for x in c.get("r") if x.isalpha())
                v = c.find(NS + "v")
                val = v.text if v is not None else ""
                values[col] = strings[int(val)] if c.get("t") == "s" else val
            el.clear()
            if values.get("A") == "Invoice":
                continue
            counts["source_rows_scanned"] += 1
            pid = values.get("B")
            if pid not in IDS:
                continue
            counts["selected_product_source_rows"] += 1
            try:
                day = (
                    datetime(1899, 12, 30) + timedelta(days=float(values["E"]))
                ).date()
                qty = float(values["D"])
                price = float(values["F"])
            except (ValueError, KeyError):
                counts["invalid_rows"] += 1
                continue
            if not START <= day <= END:
                counts["outside_range"] += 1
                continue
            if not str(values.get("A", "")).isdigit() or qty <= 0 or price <= 0:
                counts["excluded_adjustments_or_nonpositive"] += 1
                continue
            if int(qty) != qty:
                raise ValueError("Fractional quantity")
            daily[pid, day] += int(qty)
            counts["included_invoice_lines"] += 1
            if day <= CUTOFF:
                names[pid] = values.get("C") or pid
training = BASE / "samples/uci-positive-invoice-units.csv"
with training.open("w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["date", "product_id", "product_name", "units_sold"])
    for pid in sorted(IDS):
        for offset in range((CUTOFF - START).days + 1):
            day = START + timedelta(days=offset)
            w.writerow([day, pid, names[pid], daily[pid, day]])
config = {
    "mapping": {
        "date": "date",
        "product_id": "product_id",
        "product_name": "product_name",
        "units": "units_sold",
    },
    "layout": "daily",
    "date_format": "ISO",
    "timezone": "Europe/London",
    "coverage_start": str(START),
    "coverage_end": str(CUTOFF),
    "coverage_confirmed": True,
    "gross_sales_confirmed": False,
    "quantity_basis": "positive_invoice_units_proxy",
    "demo_proxy_confirmed": True,
    "missing_days_zero": False,
}
report = normalize(training.read_bytes(), config)
result = forecast(report)
scores = []
for p in result["products"]:
    actual = [daily[p["product_id"], CUTOFF + timedelta(days=i + 1)] for i in range(28)]
    pred = [d["units"] for d in p["forecast"]]
    scores.append(
        {
            "product_id": p["product_id"],
            "name": p["name"],
            "method": p["method"],
            "external_holdout": metrics(actual, pred),
            "internal_evaluation": p["evaluation"],
        }
    )
evidence = {
    "source": "UCI Online Retail II",
    "doi": "10.24432/C5CG6D",
    "license": "CC BY 4.0",
    "creator": "Daqing Chen",
    "source_sha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
    "worksheet": "Year 2010-2011",
    "target": "positive invoice units proxy, NOT verified completed gross sales",
    "product_selection": "Three IDs fixed in Phase 1 using data no later than 2011-11-10. Not representative of all stores.",
    "coverage_assumption": "Selected products treated as active throughout the period; absent eligible invoice dates assigned zero. No availability/stockout truth.",
    "cutoff": str(CUTOFF),
    "holdout_start": "2011-11-11",
    "holdout_end": str(END),
    "final_partial_day_excluded": "2011-12-09",
    "counts": dict(counts),
    "training_daily_rows": len(report["canonical"]),
    "products": scores,
    "offline_total_seconds": round(time.perf_counter() - started, 3),
    "scope": "Offline workbook scan, adaptation and three-product evaluation; not a web upload or service-capacity benchmark.",
}
(BASE / "evidence/uci-evaluation.json").write_text(json.dumps(evidence, indent=2))
print(
    json.dumps(
        {
            "source_rows": counts["source_rows_scanned"],
            "products": [
                (
                    s["product_id"],
                    s["method"],
                    round(s["external_holdout"]["wape"] * 100, 1),
                )
                for s in scores
            ],
            "seconds": evidence["offline_total_seconds"],
        }
    )
)
