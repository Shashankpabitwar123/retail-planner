import { useState, useEffect } from "react";
import { Button, Notice } from "./UI";
import {
  num,
  friendlyDate,
  download,
  forecastCSV,
  type Result,
  type Product,
  type Plan,
} from "./data";
import { QualityView } from "./Review";
import StoreRestock from "./StoreRestock";

export default function Results({
  result,
  jobId,
  plans,
  onSaveAll,
  onBackup,
  onSelected,
  onAddData,
  onTryOwn,
  requestedTab,
}: {
  result: Result;
  jobId: string | null;
  plans: Record<string, Plan>;
  onSaveAll: (plans: Record<string, Plan>) => Promise<void>;
  onPlan: (id: string, p: Plan) => Promise<void>;
  onExplain: (p: Plan) => void;
  onBackup: () => void;
  onSelected: (id: string) => void;
  onAddData: () => void;
  onTryOwn: () => void;
  requestedTab?: { name: string; revision: number };
}) {
  const [tab, setTab] = useState("Forecasts"),
    [query, setQuery] = useState(""),
    [id, setId] = useState(
      result.products.find((p) => p.forecast?.length)?.product_id ||
        result.products[0]?.product_id ||
        "",
    );

  useEffect(() => {
    if (requestedTab) setTab(requestedTab.name);
  }, [requestedTab]);
  const product = result.products.find((p) => p.product_id === id);
  const filtered = result.products.filter((p) =>
    (p.product_id + " " + p.name).toLowerCase().includes(query.toLowerCase()),
  );
  const quality = { ...result.quality, products: result.products };
  const olderSales = result.forecast_start < new Date().toISOString().slice(0, 10);
  const missingSales = result.products.some(p => p.missing_days > 0);
  const shortHistory = result.products.some(p => p.usable_days < 84);
  const updatePrompt = olderSales
    ? {message: `Your sales end on ${friendlyDate(result.quality.coverage_end)}. Add recent sales to update your plan.`, label: "Add recent sales"}
    : missingSales ? {message: "Some sales days are missing. Add those records to complete your history.", label: "Add missing sales"}
    : shortHistory ? {message: "More sales history will help us test this forecast.", label: "Add more sales"}
    : {message: "Have newer sales? Keep your forecast up to date.", label: "Update sales"};
  return (
    <>
      <div className="page-heading results-heading">
        <p className="eyebrow">
          {result.quality.config.synthetic
            ? "SAMPLE RESULTS"
            : "YOUR SALES OUTLOOK"}
        </p>
        <h1>{tab === "Inventory" ? "What should I restock?" : tab === "Data quality" ? "Can I use this data?" : "How much will sell?"}</h1>
        <p>
          {friendlyDate(result.forecast_start)} – {friendlyDate(result.forecast_end)} ·{" "}
          {result.products.filter((p) => p.forecast?.length).length} products
        </p>
      </div>
      {result.quality.config.synthetic && <div className="sample-results-intro compact-sample">
        <span>You’re exploring sample store sales.</span>
        <Button variant="text" onClick={onTryOwn}>Use my own files</Button>
        <details><summary>About this example</summary><p>Fictional sales with fixed dates and repeating patterns. Real sales may be less predictable. Example stock values can be edited in Restock.</p></details>
      </div>}
      {!result.quality.config.synthetic && <section className={"sales-update-card" + (olderSales || missingSales || shortHistory ? " needs-data" : "")}>
        <div><strong>{olderSales || missingSales || shortHistory ? "Improve your sales history" : "Keep your plan up to date"}</strong><p>{updatePrompt.message}</p></div>
        <Button variant="secondary" onClick={onAddData}>{updatePrompt.label}</Button>
      </section>}
      {result.products.some((p) => !p.forecast?.length) && (
        <Notice tone="warning">
          Some products need more complete sales history. Select a product to
          see what’s missing.
        </Notice>
      )}
      <div className="action-row">
        <div className="tabs" role="tablist" aria-label="Result view">
          {["Forecasts", "Inventory", "Data quality"].map((t) => (
            <button
              key={t}
              role="tab"
              id={`tab-${t.replaceAll(" ", "-")}`}
              aria-controls="result-panel"
              tabIndex={t === tab ? 0 : -1}
              onKeyDown={(e) => {
                const labels = ["Forecasts", "Inventory", "Data quality"];
                let next = labels.indexOf(t);
                if (e.key === "ArrowRight") next = (next + 1) % 3;
                else if (e.key === "ArrowLeft") next = (next + 2) % 3;
                else if (e.key === "Home") next = 0;
                else if (e.key === "End") next = 2;
                else return;
                e.preventDefault();
                setTab(labels[next]);
                (
                  e.currentTarget.parentElement?.children[next] as HTMLElement
                )?.focus();
              }}
              aria-selected={t === tab}
              onClick={() => setTab(t)}
            >
              {t === "Inventory" ? "Restock" : t === "Data quality" ? "Data check" : "Sales forecast"}
            </button>
          ))}
        </div>
        <div className="inline-actions">
          <Button
            variant="secondary"
            onClick={() => download(`sales-forecast-${result.forecast_start}-to-${result.forecast_end}.csv`, forecastCSV(result))}
          >
            Download sales forecast
          </Button>
          <Button variant="secondary" title="Save a file you can reopen in Retail Planner" onClick={onBackup}>
            Download backup
          </Button>
        </div>
      </div>

      <section
        id="result-panel"
        role="tabpanel"
        aria-labelledby={`tab-${tab.replaceAll(" ", "-")}`}
      >
        <div hidden={tab !== "Inventory"}><StoreRestock result={result} jobId={jobId} saved={plans} onSave={onSaveAll} onAddData={onAddData}/></div>
        {tab === "Data quality" ? (
          <QualityView quality={quality} />
        ) : tab === "Forecasts" ? (
          <div className="forecast-layout">
            <label className="field mobile-product">
              Product
              <select
                value={id}
                onChange={(e) => {
                  setId(e.target.value);
                  onSelected(e.target.value);
                }}
              >
                {result.products.map((p) => (
                  <option key={p.product_id} value={p.product_id}>
                    {p.name} ·{" "}
                    {p.forecast?.length
                      ? num(p.forecast_total) + " units"
                      : "Needs attention"}
                  </option>
                ))}
              </select>
            </label>
            <aside className="product-list">
              <label className="field">
                Find a product
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search name or ID"
                />
              </label>
              {filtered.map((p) => (
                <button
                  className={
                    "product-row " + (p.product_id === id ? "selected" : "")
                  }
                  key={p.product_id}
                  onClick={() => {
                    setId(p.product_id);
                    onSelected(p.product_id);
                  }}
                >
                  <span>
                    <strong>{p.name}</strong>

                  </span>
                  <span>
                    {p.forecast?.length
                      ? num(p.forecast_total) + " units"
                      : "Needs attention"}
                  </span>
                </button>
              ))}
              {!filtered.length && <p>No matching products.</p>}
            </aside>
            <div className="forecast-detail">
              {product && <Forecast key={product.product_id} product={product} onAddData={result.quality.config.synthetic ? onTryOwn : onAddData} onRestock={() => setTab("Inventory")} />}

            </div>
          </div>
        ) : null}
      </section>
    </>
  );
}
function Forecast({ product: p, onRestock, onAddData }: { product: Product; onRestock: () => void; onAddData: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [activePoint, setActivePoint] = useState<string>("");
  const last = p.evaluation?.windows.at(-1);
  const history = (p.history || []).slice(-28),
    future = p.forecast || [];
  const values = [
    ...history.map((x) => x.units),
    ...future.map((x) => x.units),
  ];
  const max = Math.max(1, ...values.map((v) => v ?? 0)) * 1.15;
  const point = (v: number, i: number) =>
    `${40 + (i * 660) / Math.max(1, values.length - 1)},${215 - (v / max) * 170}`;
  const line = (data: (number | null)[], offset: number) =>
    data
      .map((v, i) =>
        v == null
          ? ""
          : `${i === 0 || data[i - 1] == null ? "M" : "L"}${point(v, i + offset)}`,
      )
      .join(" ");
  return (
    <>
      <div className="detail-heading forecast-summary-heading">
        <div>
          <h2>{p.name}</h2>
          <p className="muted">
            Product ID: {p.product_id}
          </p>
        </div>
        {future.length > 0 && <div className="restock-shortcut">
          <Button onClick={onRestock}>Check how much to restock</Button>
          <small>{p.inventory_eligible ? "Add stock and delivery details to make a plan." : "See what’s needed before planning stock."}</small>
        </div>}
      </div>
      {!future.length ? (
        <Notice tone="warning">
          {p.missing_days > 0
            ? `We need the missing ${p.missing_days} day(s) of sales before forecasting this product.`
            : p.status === "summary_only"
              ? "We need more sales history before forecasting this product."
              : "Some sales records need fixing before we can forecast this product. Open Data check to see what to fix."}
          <Button variant="text" onClick={onAddData}>Add more sales</Button>
        </Notice>
      ) : (
        <>
          <div className="forecast-summary-card">
          <div className="metric-strip">
            <div>
              <small>Estimated sales · these 28 days</small>
              <strong>{num(p.forecast_total)} units</strong>
            </div>
            <div>
              <small>Average per day</small>
              <strong>{num((p.forecast_total || 0) / future.length)} units</strong>
            </div>
          </div>
          <div className="forecast-confidence">
            <span className="badge">{!last ? "Not yet tested" : p.inventory_eligible ? "Passed our checks" : "Use cautiously"}</span>
            {!last && <p>Based on {p.usable_days} complete days. {p.usable_days < 84 ? `Add at least ${84 - p.usable_days} more complete days so we can test this estimate.` : "There is not enough usable history for a complete test."} Passing is not guaranteed.</p>}
            {!last && <Button variant="secondary" onClick={onAddData}>Add sales data</Button>}
            <p>{last ? `In a past test, daily predictions differed from actual sales by about ${num(last.model.mae)} units on average.` : "This estimate has not been tested against enough past sales yet."} Future sales may differ.</p>
            {!p.inventory_eligible && <p>Stock recommendations aren’t available for this product yet.</p>}
          </div>
          </div>
          {p.forecast_warning && <Notice tone="warning">{p.forecast_warning}</Notice>}
          <section className="daily-preview">
            <h3>Daily sales estimate</h3>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Estimated units</th>
                  </tr>
                </thead>
                <tbody>
                  {(expanded ? future : future.slice(0, 5)).map((d) => (
                    <tr key={d.date}>
                      <td>{friendlyDate(d.date)}</td>
                      <td>{num(d.units)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button variant="text" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "Show fewer days" : `Show all ${future.length} days`}</Button>
          </section>
          <section className="forecast-chart-section">
            <h3>Past sales and estimated sales</h3>
            <p className="chart-legend">Gray solid: actual sales · Green dashed: estimates</p>
            <p className="chart-readout" aria-live="polite">{activePoint || "Select a point to see its date and units."}</p>
          <svg
            className="live-chart"
            viewBox="0 0 740 260"
            role="img"
            aria-label="Recent actual sales in gray and estimates in green. Units sold by date."
          >
            <line x1="40" y1="215" x2="710" y2="215" stroke="#dce4de" />
            <path
              d={line(
                history.map((x) => x.units),
                0,
              )}
              fill="none"
              stroke="#98a39b"
              strokeWidth="2"
            />
            <path
              d={line(
                future.map((x) => x.units),
                history.length,
              )}
              fill="none"
              stroke="#27624d"
              strokeWidth="3"
              strokeDasharray="6 4"
            />
            <line
              x1={40 + (history.length * 660) / (values.length - 1)}
              x2={40 + (history.length * 660) / (values.length - 1)}
              y1="25"
              y2="215"
              stroke="#b5cbbc"
              strokeDasharray="4"
            />
            <text x="40" y="245">
              {history.length ? friendlyDate(history[0].date) : friendlyDate(future[0].date)}
            </text>
            <text x="590" y="245">
              {friendlyDate(future.at(-1)!.date)}
            </text>
            <text x="5" y="215">
              0
            </text>
            <text x="5" y="45">
              {Math.ceil(max)}
            </text>
            <text x="40" y="18">Units sold</text>
            <text x={40 + (history.length * 660) / Math.max(1, values.length - 1)} y="35">Forecast starts</text>
            {[...history, ...future].map((d, i) => d.units == null ? null : <circle key={i} cx={40 + i * 660 / Math.max(1, values.length - 1)} cy={215 - d.units / max * 170} r="5" fill={i < history.length ? "#98a39b" : "#27624d"} tabIndex={0} role="button" onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setActivePoint(`${friendlyDate(d.date)} · ${num(d.units)} ${i < history.length ? "sold" : "estimated"} units`); } }} aria-label={`${friendlyDate(d.date)}: ${num(d.units)} ${i < history.length ? "sold" : "estimated"} units`} onMouseEnter={() => setActivePoint(`${friendlyDate(d.date)} · ${num(d.units)} ${i < history.length ? "sold" : "estimated"} units`)} onFocus={() => setActivePoint(`${friendlyDate(d.date)} · ${num(d.units)} ${i < history.length ? "sold" : "estimated"} units`)} onClick={() => setActivePoint(`${friendlyDate(d.date)} · ${num(d.units)} ${i < history.length ? "sold" : "estimated"} units`)} />)}
          </svg>
          </section>

          <details className="quiet-details">
            <summary>How we checked this</summary>
            <p>
              Based on {p.usable_days} complete days of sales history. {last ? "We tested the method on past sales that were kept out of training." : "There is not enough history for a full test."}
              Future sales can still differ. Selected method:{" "}
              {p.method?.replaceAll("_", " ")}.
            </p>
            {p.range && (
              <Notice>
                Estimated 28-day total range: {num(p.range.total.lower)}–
                {num(p.range.total.upper)} units. Target coverage:{" "}
                {p.range.nominal_coverage * 100}%; calibration:{" "}
                {p.range.calibration_windows} periods; final-period daily
                coverage: {num(p.range.evaluation_daily_coverage * 100)}%.
                Temporal dependence means coverage is not guaranteed.
              </Notice>
            )}
            <p className="muted">
              {p.range_reason} {!p.range && "No prediction band is shown."}
            </p>
            <section>
              <h3>Historical test details</h3>
              {last ? (
                <>
                  <p>
                    {p.evaluation?.kind === "untouched_final_holdout"
                      ? "Final test period, kept separate from method selection"
                      : "Limited baseline testing"}{" "}
                    · {friendlyDate(last.start)} – {friendlyDate(last.end)}
                  </p>
                  <div className="metric-strip">
                    <div>
                      <small>Average daily error</small>
                      <strong>{num(last.model.mae)} units</strong>
                    </div>
                    <div>
                      <small>Weighted absolute error (WAPE)</small>
                      <strong>
                        {last.model.wape == null
                          ? "Undefined: zero actual sales"
                          : num(last.model.wape * 100) + "%"}
                      </strong>
                    </div>
                    <div>
                      <small>Weekly baseline MAE</small>
                      <strong>{num(last.baseline.mae)} units</strong>
                    </div>
                  </div>
                  <p>
                    Bias: {num(last.model.bias_units_per_day)} units/day. 28-day
                    total error: {num(last.model.total_absolute_error)} units.{" "}
                    {p.evaluation?.windows.length} evaluation window(s).
                  </p>
                  <p className="muted">
                    Lower error is better. These are historical errors, not a
                    percentage guarantee of future accuracy.
                  </p>
                </>
              ) : (
                <p>
                  Not enough history for a full 28-day test after 56 training
                  days. Treat this as an untested baseline; inventory
                  recommendations are withheld.
                </p>
              )}
            </section>
          </details>

        </>
      )}
    </>
  );
}
