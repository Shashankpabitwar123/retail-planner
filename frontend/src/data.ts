export function friendlyDate(value: string) {
  const date = new Date(value + "T00:00:00Z");
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}
export type Mapping = Record<string, string>;
export type Config = {
  coverage_upload_id?: string;
  date_status_upload_id?: string;
  compare_review_id?: string;
  event_labels?: Record<string, string>;
  event_labels_text?: string;
  exclude_product_ids?: string[];
  allow_product_renames?: boolean;
  synthetic?: boolean;
  mapping: Mapping;
  layout: string;
  date_format: string;
  number_format: string;
  timezone: string;
  coverage_start: string;
  coverage_end: string;
  coverage_confirmed: boolean;
  gross_sales_confirmed: boolean;
  missing_days_zero: boolean;
  deduplicate_events: boolean;
  store_id: string;
};
export type Upload = {
  id: string;
  digest: string;
  duplicate: boolean;
  headers: string[];
  row_count: number;
  preview: Record<string, string>[];
  suggested_mapping: Mapping;
  suggested_layout: string;
  suggested_range: [string, string] | null;
};
export type Issue = {
  code: string;
  message: string;
  product_id: string;
  row: number | null;
  blocking: boolean;
};
export type Metric = {
  mae: number;
  wape: number | null;
  bias_units_per_day: number;
  total_absolute_error: number;
  actual_total: number;
  predicted_total: number;
};
export type Product = {
  missing_date_examples?: string[];
  range?: {
    nominal_coverage: number;
    calibration_windows: number;
    evaluation_windows: number;
    evaluation_daily_coverage: number;
    evaluation_total_covered: boolean;
    total: { lower: number; upper: number };
    daily: { date: string; lower: number; upper: number }[];
    method: string;
  } | null;
  forecast_warning?: string | null;
  product_id: string;
  name: string;
  status: string;
  days: number;
  usable_days: number;
  total_units: number;
  missing_days: number;
  stockout_days: number;
  history?: { date: string; units: number | null }[];
  forecast?: { date: string; units: number }[];
  forecast_total?: number;
  method?: string;
  range_reason?: string;
  inventory_eligible?: boolean;
  evaluation?: {
    kind: string;
    windows: {
      start: string;
      end: string;
      training_days: number;
      model: Metric;
      baseline: Metric;
    }[];
  } | null;
};
export type Quality = {
  comparison?: {
    identical_keys: number;
    changed_keys: number;
    new_keys: number;
    removed_keys: number;
    action: string;
    changes: {
      product_id: string;
      date: string;
      previous_units: number | null;
      new_units: number | null;
    }[];
  };
  products: Product[];
  issues: Issue[];
  issue_counts: Record<string, number>;
  rows: number;
  eligible_products: number;
  global_block: boolean;
  coverage_start: string;
  coverage_end: string;
  config: Config;
};
export type Result = {
  engine_revision: string;
  horizon_days: number;
  forecast_start: string;
  forecast_end: string;
  products: Product[];
  quality: Quality;
  notice: string;
};
export type Job = {
  settings?: Config;
  source_name?: string;
  source_digest?: string;
  id: string;
  upload: string;
  kind: string;
  state: string;
  stage: string;
  done: number;
  total: number;
  cancel: number;
  created: number;
  expires: number;
  error: string | null;
  result?: Quality | Result;
};
export type StockDay = {
  date: string;
  opening_units: number;
  incoming_units: number;
  proposed_receipt_units: number;
  forecast_units: number;
  unmet_units: number;
  closing_units: number;
};
export type Plan = {
  stock_before_new_order_on_arrival?: number;
  protection_units?: number;
  daily_stock?: StockDay[];
  planning_date: string;
  arrival_date: string;
  pre_arrival_unmet_units: number;
  first_shortfall_date: string | null;
  suggested_order_units: number;
  raw_order_units: number;
  buffer_units: number;
  end_protection_stock_with_order: number;
  notice: string;
  mode: string;
  assumptions: Record<string, unknown>;
};
export type Snapshot = {
  summaryOnly?: boolean;
  id: string;
  created: string;
  name: string;
  digest: string;
  result: Result;
  plans: Record<string, Plan>;
};
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch("/api" + path, {
    ...init,
    headers: { "X-Retail-Client": "web", ...init.headers },
  });
  let data;
  try {
    data = await r.json();
  } catch {
    throw Error("Server is waking up or unavailable. Please retry shortly.");
  }
  if (!r.ok)
    throw Object.assign(
      Error(
        typeof data.detail === "string"
          ? data.detail
          : "Request failed. Please retry.",
      ),
      { status: r.status },
    );
  return data;
}
export const post = <T>(path: string, data: unknown = {}) =>
  api<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
export const num = (n: number | null | undefined) =>
  n == null
    ? "Not available"
    : new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(n);
export function download(name: string, content: string, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function csv(rows: unknown[][]) {
  return rows
    .map((r) =>
      r
        .map((v) => {
          let s = String(v ?? "");
          if (/^[\s]*[=+@-]/.test(s) || /^[\t\r]/.test(s)) s = "'" + s;
          return '"' + s.replaceAll('"', '""') + '"';
        })
        .join(","),
    )
    .join("\r\n");
}
export function forecastCSV(result: Result) {
  return csv([
    ["Product", "Product ID", "Date", "Estimated units sold", "Forecast starts", "Forecast ends", "Reliability", "Notes"],
    ...result.products.flatMap(p => {
      const reliability = !p.forecast?.length ? "Unavailable" : !p.evaluation ? "Not yet tested" : p.inventory_eligible ? "Passed our checks" : "Use cautiously";
      const note = p.forecast_warning || "Estimates are not guaranteed sales.";
      const dates = p.forecast?.length ? p.forecast : [{date:"", units:""}];
      return dates.map(d => [p.name,p.product_id,d.date ? friendlyDate(d.date) : "",d.units,friendlyDate(result.forecast_start),friendlyDate(result.forecast_end),reliability,note]);
    }),
  ]);
}
// Detect accidental edits/corruption; this checksum is not a security signature.
function checksum(value: unknown) {
  let hash = 2166136261;
  for (const ch of JSON.stringify(value)) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
export function backup(snapshot: Snapshot) {
  return JSON.stringify(
    {
      format: "retail-planner",
      revision: 2,
      checksum: checksum(snapshot),
      snapshot,
    },
    null,
    2,
  );
}
export function restore(text: string): Snapshot {
  if (new Blob([text]).size > 25 * 1024 * 1024)
    throw Error("Backup exceeds the 25 MiB local history limit.");
  const doc = JSON.parse(text),
    s = doc?.snapshot,
    r = s?.result;
  const bad = () => {
    throw Error("This workspace contains invalid or unsupported result data.");
  };
  const string = (v: unknown) => typeof v === "string" && v.length <= 4000;
  const finite = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 1e15;
  const day = (v: unknown) =>
    typeof v === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    Number.isFinite(Date.parse(v)) &&
    new Date(v).toISOString().slice(0, 10) === v;
  if (
    doc?.format !== "retail-planner" ||
    ![1, 2].includes(doc.revision) ||
    (doc.revision === 2 && doc.checksum !== checksum(s)) ||
    !r ||
    r.horizon_days !== 28 ||
    !string(s.name) ||
    !Array.isArray(r.products) ||
    r.products.length > 500 ||
    !r.quality ||
    !day(r.forecast_start) ||
    !day(r.forecast_end) ||
    Date.parse(r.forecast_end) - Date.parse(r.forecast_start) !== 27 * 86400000
  )
    bad();
  const ids = new Set();
  const products: Product[] = r.products.map((p: Product) => {
    if (
      !p ||
      !string(p.product_id) ||
      !string(p.name) ||
      ids.has(p.product_id) ||
      !["ready", "limited", "summary_only", "needs_review"].includes(
        p.status,
      ) ||
      !Array.isArray(p.forecast) ||
      ![0, 28].includes(p.forecast.length) ||
      ![
        p.days,
        p.usable_days,
        p.total_units,
        p.missing_days,
        p.stockout_days,
      ].every((v) => finite(v) && v >= 0)
    )
      bad();
    ids.add(p.product_id);
    const forecast = p.forecast!.map((d, i) => {
      const expected = new Date(Date.parse(r.forecast_start) + i * 86400000)
        .toISOString()
        .slice(0, 10);
      if (d?.date !== expected || !finite(d.units) || d.units < 0) bad();
      return { date: d.date, units: d.units };
    });
    if (
      forecast.length &&
      (!finite(p.forecast_total) ||
        Math.abs(
          forecast.reduce((n, d) => n + d.units, 0) - p.forecast_total!,
        ) > 0.001 ||
        ![
          "seasonal_naive",
          "mean_28",
          "mean_56",
          "exponential_level",
          "weekday_mean",
          "croston_sba",
        ].includes(p.method || ""))
    )
      bad();
    if (p.history && (!Array.isArray(p.history) || p.history.length > 56))
      bad();
    const history = (p.history || []).map((d) => {
      if (
        !d ||
        !day(d.date) ||
        (d.units !== null && (!finite(d.units) || d.units < 0))
      )
        bad();
      return { date: d.date, units: d.units };
    });
    let evaluation: Product["evaluation"] = null;
    if (p.evaluation) {
      const e = p.evaluation;
      if (
        !["untouched_final_holdout", "limited_baseline_test"].includes(
          e.kind,
        ) ||
        !Array.isArray(e.windows) ||
        e.windows.length > 3
      )
        bad();
      evaluation = {
        kind: e.kind,
        windows: e.windows.map((w) => {
          if (!day(w.start) || !day(w.end) || !finite(w.training_days)) bad();
          const metric = (m: Metric) => {
            if (
              !m ||
              ![
                m.mae,
                m.bias_units_per_day,
                m.total_absolute_error,
                m.actual_total,
                m.predicted_total,
              ].every(finite) ||
              (m.wape !== null && !finite(m.wape))
            )
              bad();
            return {
              mae: m.mae,
              wape: m.wape,
              bias_units_per_day: m.bias_units_per_day,
              total_absolute_error: m.total_absolute_error,
              actual_total: m.actual_total,
              predicted_total: m.predicted_total,
            };
          };
          return {
            start: w.start,
            end: w.end,
            training_days: w.training_days,
            model: metric(w.model),
            baseline: metric(w.baseline),
          };
        }),
      };
    }
    let range: Product["range"] = null;
    if (p.range) {
      const b = p.range;
      const bound = (x: { lower: number; upper: number }) =>
        x &&
        finite(x.lower) &&
        finite(x.upper) &&
        x.lower >= 0 &&
        x.upper >= x.lower;
      if (
        b.nominal_coverage !== 0.9 ||
        b.calibration_windows !== 9 ||
        b.evaluation_windows !== 1 ||
        !finite(b.evaluation_daily_coverage) ||
        b.evaluation_daily_coverage < 0 ||
        b.evaluation_daily_coverage > 1 ||
        typeof b.evaluation_total_covered !== "boolean" ||
        !string(b.method) ||
        !bound(b.total) ||
        !Array.isArray(b.daily) ||
        b.daily.length !== 28
      )
        bad();
      if (b.daily.some((x, i) => !bound(x) || x.date !== forecast[i]?.date))
        bad();
      range = {
        nominal_coverage: b.nominal_coverage,
        calibration_windows: b.calibration_windows,
        evaluation_windows: b.evaluation_windows,
        evaluation_daily_coverage: b.evaluation_daily_coverage,
        evaluation_total_covered: b.evaluation_total_covered,
        method: b.method,
        total: { lower: b.total.lower, upper: b.total.upper },
        daily: b.daily.map((x) => ({
          date: x.date,
          lower: x.lower,
          upper: x.upper,
        })),
      };
    }
    return {
      range,
      forecast_warning:
        typeof p.forecast_warning === "string" ? p.forecast_warning : null,
      product_id: p.product_id,
      name: p.name,
      status: p.status,
      days: p.days,
      usable_days: p.usable_days,
      total_units: p.total_units,
      missing_days: p.missing_days,
      stockout_days: p.stockout_days,
      history,
      forecast,
      forecast_total: forecast.reduce((n, d) => n + d.units, 0),
      method: p.method,
      evaluation,
      inventory_eligible: false,
      range_reason:
        typeof p.range_reason === "string"
          ? p.range_reason
          : "No calibrated range available.",
    };
  });
  const q = r.quality;
  if (
    !Array.isArray(q.issues) ||
    q.issues.length > 150 ||
    !day(q.coverage_start) ||
    !day(q.coverage_end) ||
    ![q.rows, q.eligible_products].every(finite) ||
    typeof q.global_block !== "boolean" ||
    !q.config ||
    typeof q.config !== "object" ||
    !q.issue_counts ||
    typeof q.issue_counts !== "object"
  )
    bad();
  const issues: Issue[] = q.issues.map((i: Issue) => {
    if (
      !i ||
      ![i.code, i.message, i.product_id].every(string) ||
      typeof i.blocking !== "boolean" ||
      (i.row !== null && i.row !== undefined && !finite(i.row))
    )
      bad();
    return {
      code: i.code,
      message: i.message,
      product_id: i.product_id,
      row: i.row ?? null,
      blocking: i.blocking,
    };
  });
  const issue_counts: Record<string, number> = {};
  for (const [k, v] of Object.entries(q.issue_counts)) {
    if (!finite(v) || k === "__proto__") bad();
    issue_counts[k] = v as number;
  }
  const config: Config = {
    mapping: {},
    layout: "daily",
    date_format: "ISO",
    number_format: "dot",
    timezone: "Etc/UTC",
    coverage_start: q.coverage_start,
    coverage_end: q.coverage_end,
    coverage_confirmed: false,
    gross_sales_confirmed: false,
    missing_days_zero: false,
    deduplicate_events: false,
    store_id: "",
    synthetic: q.config.synthetic === true,
  };
  // Preserve explicit import assumptions only; no tokens, raw records or arbitrary fields.
  for (const key of [
    "layout",
    "date_format",
    "number_format",
    "timezone",
    "store_id",
  ] as const)
    if (string(q.config[key])) config[key] = q.config[key];
  for (const key of [
    "coverage_confirmed",
    "gross_sales_confirmed",
    "missing_days_zero",
    "deduplicate_events",
  ] as const)
    config[key] = q.config[key] === true;
  if (q.config.mapping && typeof q.config.mapping === "object")
    for (const key of [
      "date",
      "product_id",
      "product_name",
      "units",
      "event_id",
      "event_type",
      "store_id",
      "date_status",
    ])
      if (string(q.config.mapping[key]))
        config.mapping[key] = q.config.mapping[key];
  const result: Result = {
    engine_revision: string(r.engine_revision) ? r.engine_revision : "unknown",
    horizon_days: 28,
    forecast_start: r.forecast_start,
    forecast_end: r.forecast_end,
    products,
    quality: {
      products,
      issues,
      issue_counts,
      rows: q.rows,
      eligible_products: q.eligible_products,
      global_block: q.global_block,
      coverage_start: q.coverage_start,
      coverage_end: q.coverage_end,
      config,
    },
    notice:
      "Restored result supplied by this workspace file. Re-upload the original sales data to recompute or verify it.",
  };
  return {
    id: crypto.randomUUID(),
    created: new Date().toISOString(),
    name: s.name.slice(0, 120),
    digest: typeof s.digest === "string" ? s.digest : "",
    result,
    plans: validatePlans(s.plans, new Set(products.map((p) => p.product_id))),
  };
}
function validatePlans(value: unknown, ids: Set<string>): Record<string, Plan> {
  const validDay = (v: unknown): v is string =>
    typeof v === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    Number.isFinite(Date.parse(v)) &&
    new Date(v).toISOString().slice(0, 10) === v;
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, Plan> = Object.create(null);
  for (const [id, v] of Object.entries(value)) {
    const p = v as Plan;
    if (
      !p ||
      !ids.has(id) ||
      ![
        p.suggested_order_units,
        p.pre_arrival_unmet_units,
        p.raw_order_units,
        p.buffer_units,
        p.end_protection_stock_with_order,
      ].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0) ||
      !validDay(p.arrival_date) ||
      !validDay(p.planning_date) ||
      (p.first_shortfall_date !== null && !validDay(p.first_shortfall_date)) ||
      typeof p.notice !== "string" ||
      !["historical_replay", "current"].includes(p.mode)
    )
      throw Error("Backup has an invalid inventory plan.");
    const assumptions: Record<string, unknown> = {};
    for (const k of [
      "stock",
      "snapshot_date",
      "lead_days",
      "review_days",
      "buffer_days",
      "pack_size",
      "minimum_order",
      "mode",
      "confirmed",
      "incoming",
      "timezone",
      "product_id",
    ])
      if (p.assumptions && Object.hasOwn(p.assumptions, k))
        assumptions[k] = p.assumptions[k];
    const a = assumptions;
    const integer = (v: unknown, lo: number, hi: number) =>
      typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
    if (
      a.product_id !== id ||
      !validDay(a.snapshot_date) ||
      a.mode !== p.mode ||
      a.confirmed !== true ||
      !integer(a.stock, 0, 1e9) ||
      !integer(a.lead_days, 1, 28) ||
      !integer(a.review_days, 1, 28) ||
      !integer(a.buffer_days, 0, 28) ||
      !integer(a.pack_size, 1, 1e9) ||
      !integer(a.minimum_order, 0, 1e9) ||
      !Array.isArray(a.incoming) ||
      a.incoming.length > 100
    )
      throw Error("Backup has invalid inventory assumptions.");
    const seen = new Set<string>();
    a.incoming = a.incoming.map((line: any) => {
      if (
        !line ||
        typeof line.id !== "string" ||
        !line.id.length ||
        line.id.length > 120 ||
        seen.has(line.id) ||
        !validDay(line.date) ||
        !integer(line.units, 1, 1e9) ||
        !["open", "received", "cancelled"].includes(line.status)
      )
        throw Error("Backup has invalid incoming stock.");
      seen.add(line.id);
      return {
        id: line.id,
        date: line.date,
        units: line.units,
        status: line.status,
      };
    });
    if (a.timezone !== undefined && typeof a.timezone !== "string")
      throw Error("Backup has invalid timezone.");
    let daily_stock: StockDay[] | undefined;
    if (p.daily_stock) {
      if (!Array.isArray(p.daily_stock) || p.daily_stock.length !== 28)
        throw Error("Backup has an invalid daily stock projection.");
      daily_stock = p.daily_stock.map((d, i) => {
        const expected = new Date(Date.parse(p.planning_date) + i * 86400000)
          .toISOString()
          .slice(0, 10);
        const keys = [
          "opening_units",
          "incoming_units",
          "proposed_receipt_units",
          "forecast_units",
          "unmet_units",
          "closing_units",
        ] as const;
        if (
          d.date !== expected ||
          keys.some(
            (k) =>
              typeof d[k] !== "number" || !Number.isFinite(d[k]) || d[k] < 0,
          ) ||
          Math.abs(
            Math.max(
              0,
              d.opening_units +
                d.incoming_units +
                d.proposed_receipt_units -
                d.forecast_units,
            ) - d.closing_units,
          ) > 0.001
        )
          throw Error("Backup has an invalid daily stock projection.");
        return {
          date: d.date,
          opening_units: d.opening_units,
          incoming_units: d.incoming_units,
          proposed_receipt_units: d.proposed_receipt_units,
          forecast_units: d.forecast_units,
          unmet_units: d.unmet_units,
          closing_units: d.closing_units,
        };
      });
    }
    out[id] = {
      daily_stock,
      planning_date: p.planning_date,
      arrival_date: p.arrival_date,
      pre_arrival_unmet_units: p.pre_arrival_unmet_units,
      first_shortfall_date: p.first_shortfall_date,
      suggested_order_units: p.suggested_order_units,
      raw_order_units: p.raw_order_units,
      buffer_units: p.buffer_units,
      end_protection_stock_with_order: p.end_protection_stock_with_order,
      notice: p.notice,
      mode: p.mode,
      assumptions,
    };
  }
  return out;
}
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("retail-planner", 1);
    r.onupgradeneeded = () =>
      r.result.createObjectStore("history", { keyPath: "id" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () =>
      reject(
        Error(
          "Browser storage unavailable. Download your results to keep them.",
        ),
      );
  });
}
export async function historyList(): Promise<Snapshot[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("history", "readonly");
    const request = tx.objectStore("history").getAll();
    request.onsuccess = () =>
      resolve(
        (request.result as Snapshot[]).sort((a, b) =>
          b.created.localeCompare(a.created),
        ),
      );
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}
export async function historySave(s: Snapshot) {
  const existing = await historyList();
  const tooLarge = new Blob([JSON.stringify(s)]).size > 24 * 1024 * 1024;
  const stored = tooLarge
    ? {
        ...s,
        summaryOnly: true,
        plans: {},
        result: {
          ...s.result,
          products: s.result.products.map((p) => ({
            ...p,
            history: [],
            forecast: [],
            range: null,
            selection: undefined,
          })),
          quality: {
            ...s.result.quality,
            canonical: [],
            issues: s.result.quality.issues
              .slice(0, 20)
              .map((i) => ({ ...i, message: i.message.slice(0, 500) })),
          },
        },
      }
    : s;
  const entries = [stored, ...existing.filter((x) => x.id !== s.id)].slice(
    0,
    10,
  );
  let size = 0;
  const kept = entries.filter((e) => {
    size += new Blob([JSON.stringify(e)]).size;
    return size <= 25 * 1024 * 1024;
  });
  if (!kept.some((e) => e.id === s.id))
    throw Error(
      "Result is too large for local history. Download a workspace backup now.",
    );
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("history", "readwrite");
    const store = tx.objectStore("history");
    store.clear();
    kept.forEach((e) => store.put(e));
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(Error("Browser storage is full. Download your results."));
    };
  });
  return tooLarge;
}
export async function historyDelete(id: string) {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("history", "readwrite");
    tx.objectStore("history").delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}
