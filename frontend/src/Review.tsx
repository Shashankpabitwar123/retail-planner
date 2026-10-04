import AIMapping from "./AIMapping";
import ImportOptions, { Comparison } from "./ImportOptions";
import { Button, Notice, Steps } from "./UI";
import { num, csv, download, type Config, type Upload, type Quality } from "./data";
const fields: Record<string, string> = {
  product_id: "Product ID",
  product_name: "Product name (optional)",
  date: "Sales date",
  units: "Units sold",
  event_id: "Event / line ID (optional)",
  event_type: "Event type (optional)",
  store_id: "Store ID (optional)",
  date_status: "Observation status (optional)",
};
export function Setup({
  upload,
  config,
  setConfig,
  onRun,
  busy,
}: {
  upload: Upload;
  config: Config;
  setConfig: (c: Config) => void;
  onRun: () => void;
  busy: boolean;
}) {
  const set = (key: keyof Config, value: unknown) =>
    setConfig({ ...config, [key]: value });
  const selected = Object.values(config.mapping).filter(Boolean);
  const duplicate = new Set(selected).size !== selected.length;
  const dateExamples = upload.preview
    .slice(0, 3)
    .map((row) => row[config.mapping.date])
    .filter(Boolean)
    .map((raw) => {
      let formatted = "Does not match chosen format";
      if (config.date_format === "ISO")
        formatted = raw.includes("T")
          ? "Timestamp: converted using the store timezone during review"
          : raw;
      else {
        const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (m) {
          const month = config.date_format === "MDY" ? m[1] : m[2],
            day = config.date_format === "MDY" ? m[2] : m[1];
          formatted = `${m[3]}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
        }
      }
      return `${raw} → ${formatted}`;
    });
  return (
    <>
      <Steps active={1} />
      <div className="page-heading">
        <p className="eyebrow">UNDERSTAND YOUR DATA</p>
        <h1>A quick check before we forecast.</h1>
        <p>
          {num(upload.row_count)} rows detected. Confirm what these columns
          mean.
        </p>
      </div>
      {upload.duplicate && (
        <Notice>
          This exact file was already uploaded in this browser. We reused its
          stored copy; matching confirmed settings also reuse the analysis.
          Renamed files are recognized by content.
        </Notice>
      )}
      <AIMapping upload={upload} config={config} onChange={setConfig}/>
      <div className="live-columns">
        <section className="panel">
          <h2>Match your columns</h2>
          <label className="field">
            File layout
            <select
              value={config.layout}
              onChange={(e) => set("layout", e.target.value)}
            >
              <option value="daily">Daily product totals</option>
              <option value="transactions">Individual transaction lines</option>
              <option value="wide">
                One product per row, dates as columns
              </option>
            </select>
          </label>
          {Object.entries(fields)
            .filter(
              ([f]) =>
                config.layout !== "wide" ||
                !["date", "units", "event_id", "event_type"].includes(f),
            )
            .map(([f, label]) => (
              <label className="field" key={f}>
                {label}
                <select
                  value={config.mapping[f] || ""}
                  onChange={(e) =>
                    set("mapping", { ...config.mapping, [f]: e.target.value })
                  }
                >
                  <option value="">Not mapped</option>
                  {upload.headers.map((h) => (
                    <option key={h}>{h}</option>
                  ))}
                </select>
              </label>
            ))}
          {duplicate && (
            <Notice tone="warning">
              Each source column can be assigned only once.
            </Notice>
          )}
        </section>
        <section className="panel">
          <h2>Confirm your sales history</h2>
          <div className="field-pair">
            <label className="field">
              Date format
              <select
                value={config.date_format}
                onChange={(e) => set("date_format", e.target.value)}
              >
                <option value="ISO">YYYY-MM-DD</option>
                <option value="MDY">MM/DD/YYYY</option>
                <option value="DMY">DD/MM/YYYY</option>
              </select>
            </label>
            <label className="field">
              Decimal separator
              <select
                value={config.number_format}
                onChange={(e) => set("number_format", e.target.value)}
              >
                <option value="dot">Dot: 10.0</option>
                <option value="comma">Comma: 10,0</option>
              </select>
            </label>
          </div>
          {dateExamples.length > 0 && (
            <p className="muted">
              Date interpretation (YYYY-MM-DD): {dateExamples.join("; ")}.
              Invalid dates will be flagged during review.
            </p>
          )}
          <p className="muted">
            Whole units only. Remove thousands separators. ISO timestamps use
            the store timezone below.
          </p>
          <label className="field">
            Store timezone
            <input
              value={config.timezone}
              onChange={(e) => set("timezone", e.target.value)}
            />
          </label>
          <div className="field-pair">
            <label className="field">
              First complete sales date
              <input
                type="date"
                value={config.coverage_start}
                onChange={(e) => set("coverage_start", e.target.value)}
              />
            </label>
            <label className="field">
              Last complete sales date
              <input
                type="date"
                value={config.coverage_end}
                onChange={(e) => set("coverage_end", e.target.value)}
              />
            </label>
          </div>
          <label className="field">
            Store ID, if this file contains several stores
            <input
              value={config.store_id}
              onChange={(e) => set("store_id", e.target.value)}
              placeholder="Leave blank for one store"
            />
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={config.gross_sales_confirmed}
              onChange={(e) => set("gross_sales_confirmed", e.target.checked)}
            />
            Quantities are completed gross sales, with returns and cancellations
            separate.
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={config.coverage_confirmed}
              onChange={(e) => set("coverage_confirmed", e.target.checked)}
            />
            This export covers the entire selected period, and these products
            {config.coverage_upload_id
              ? " have the active dates listed in my coverage file."
              : " were active throughout it."}
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={config.missing_days_zero}
              onChange={(e) => set("missing_days_zero", e.target.checked)}
            />
            I confirm that absent product dates mean zero sales, not missing
            records.
          </label>
          {config.layout === "transactions" && (
            <label className="check-row">
              <input
                type="checkbox"
                checked={config.deduplicate_events}
                onChange={(e) => set("deduplicate_events", e.target.checked)}
              />
              Remove exact repeated event IDs after checking for conflicting
              values.
            </label>
          )}
          <Notice>
            Unsure about coverage? Leave it unconfirmed and check your store
            export first. Unknown dates will never be silently replaced with
            zero.
          </Notice>
        </section>
      </div>
      <details className="panel">
        <summary>Preview the uploaded file</summary>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {upload.headers.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {upload.preview.map((r, i) => (
                <tr key={i}>
                  {upload.headers.map((h) => (
                    <td key={h}>{r[h]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <ImportOptions config={config} onChange={setConfig} />
      <div className="action-row">
        <p>Mappings and confirmations are saved with this analysis.</p>
        <Button
          disabled={
            busy ||
            duplicate ||
            !config.coverage_confirmed ||
            !config.gross_sales_confirmed ||
            !config.mapping.product_id ||
            !config.coverage_start ||
            !config.coverage_end ||
            (config.layout !== "wide" &&
              (!config.mapping.date || !config.mapping.units))
          }
          onClick={onRun}
        >
          Check data quality →
        </Button>
      </div>
    </>
  );
}
export function QualityView({ quality }: { quality: Quality }) {
  return (
    <>
      <div className="metric-strip">
        <div>
          <small>Complete date range</small>
          <strong>
            {quality.coverage_start} → {quality.coverage_end}
          </strong>
        </div>
        <div>
          <small>Source rows</small>
          <strong>{num(quality.rows)}</strong>
        </div>
        <div>
          <small>Products eligible to test</small>
          <strong>{num(quality.eligible_products)}</strong>
        </div>
      </div>
      <Notice>
        Data readiness is not forecast accuracy. Each product needs at least 56
        complete days. With 168 days, we can select a method on three historical
        periods and test it on a separate final period.
      </Notice>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Complete days</th>
              <th>Sales units</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {quality.products?.map((p) => (
              <tr key={p.product_id}>
                <td>
                  {p.name}
                  <small className="block muted">{p.product_id}</small>
                </td>
                <td>
                  {p.usable_days} / {p.days}
                </td>
                <td>{num(p.total_units)}</td>
                <td>
                  <span
                    className={"badge " + (p.status === "ready" ? "good" : "")}
                  >
                    {p.status.replaceAll("_", " ")}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Comparison quality={quality} />
      <h2>What needs attention</h2>
          {quality.issues.length>0&&<Button variant="secondary" onClick={()=>download('data-issues.csv',csv([['source_row','product_id','issue','message','blocks_forecast'],...quality.issues.map(i=>[i.row??'',i.product_id,i.code,i.message,i.blocking])]))}>Download issue report (up to 150 issues)</Button>}
      {!quality.issues.length ? (
        <p>No blocking data issues found under your confirmed assumptions.</p>
      ) : (
        <ul className="issues">
          {quality.issues.map((v, i) => (
            <li key={i}>
              <strong>
                {v.product_id || "File"}
                {v.row ? ` · row ${v.row}` : ""}
              </strong>
              <span>{v.message}</span>
            </li>
          ))}
        </ul>
      )}
      {Object.entries(quality.issue_counts)
        .filter(
          ([k]) =>
            k.startsWith("excluded_") || k === "duplicate_events_removed",
        )
        .map(([k, v]) => (
          <p key={k}>
            {k.replaceAll("_", " ")}: {v}
          </p>
        ))}
    </>
  );
}
