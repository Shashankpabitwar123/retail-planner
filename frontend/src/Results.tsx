import { useState, useEffect } from "react";
import { Button, Notice } from "./UI";
import {
  num,
  download,
  forecastCSV,
  type Result,
  type Product,
  type Plan,
} from "./data";
import { QualityView } from "./Review";
import BulkInventory, { type InventoryDraft } from "./BulkInventory";
import Inventory from "./Inventory";
export default function Results({
  result,
  jobId,
  plans,
  onPlan,
  onExplain,
  onBackup,
  onSelected,
  requestedTab,
}: {
  result: Result;
  jobId: string | null;
  plans: Record<string, Plan>;
  onPlan: (id: string, p: Plan) => Promise<void>;
  onExplain: (p: Plan) => void;
  onBackup: () => void;
  onSelected: (id: string) => void;
  requestedTab?: { name: string; revision: number };
}) {
  const [tab, setTab] = useState("Forecasts"),
    [query, setQuery] = useState(""),
    [id, setId] = useState(
      result.products.find((p) => p.forecast?.length)?.product_id ||
        result.products[0]?.product_id ||
        "",
    );
  const [drafts, setDrafts] = useState<Record<string, InventoryDraft>>({});
  const [importRevision, setImportRevision] = useState(0);
  useEffect(() => {
    if (requestedTab) setTab(requestedTab.name);
  }, [requestedTab]);
  const product = result.products.find((p) => p.product_id === id);
  const filtered = result.products.filter((p) =>
    (p.product_id + " " + p.name).toLowerCase().includes(query.toLowerCase()),
  );
  const quality = { ...result.quality, products: result.products };
  return (
    <>
      <div className="page-heading">
        <p className="eyebrow">
          {result.quality.config.synthetic
            ? "SAMPLE SALES"
            : "YOUR SALES OUTLOOK"}
        </p>
        <h1>Your sales forecast.</h1>
        <p>
          {result.forecast_start} – {result.forecast_end} · 28-day forecast ·{" "}
          {result.products.filter((p) => p.forecast?.length).length} products
          forecast
        </p>
      </div>
      {result.forecast_start < new Date().toISOString().slice(0, 10) && (
        <p className="muted historical-note">
          Based on past sales · This forecast starts on {result.forecast_start}.
          Upload recent sales for a current plan.
        </p>
      )}
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
              {t}
            </button>
          ))}
        </div>
        <div className="inline-actions">
          <Button
            variant="secondary"
            onClick={() => download("sales-forecast.csv", forecastCSV(result))}
          >
            Download forecast CSV
          </Button>
          <Button variant="secondary" onClick={onBackup}>
            Save a copy
          </Button>
        </div>
      </div>
      <section
        id="result-panel"
        role="tabpanel"
        aria-labelledby={`tab-${tab.replaceAll(" ", "-")}`}
      >
        {tab === "Inventory" && Object.keys(plans).length > 0 && (
          <section className="panel">
            <h2>Applied stock actions</h2>
            <p>
              Saved scenarios only. Prioritized by unmet sales before delivery;
              this is a simulation, not an order submission.
            </p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Action</th>
                    <th>Order units</th>
                    <th>Unmet before arrival</th>
                    <th>Arrival</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(plans)
                    .sort(
                      (a, b) =>
                        b[1].pre_arrival_unmet_units -
                        a[1].pre_arrival_unmet_units,
                    )
                    .map(([pid, p]) => (
                      <tr key={pid}>
                        <td>
                          <button
                            className="text-link"
                            onClick={() => {
                              setId(pid);
                              onSelected(pid);
                            }}
                          >
                            {result.products.find((x) => x.product_id === pid)
                              ?.name || pid}
                          </button>
                        </td>
                        <td>
                          {p.pre_arrival_unmet_units > 0
                            ? "Review early shortage"
                            : p.suggested_order_units > 0
                              ? "Order suggested"
                              : "No order needed"}
                        </td>
                        <td>{num(p.suggested_order_units)}</td>
                        <td>{num(p.pre_arrival_unmet_units)}</td>
                        <td>{p.arrival_date}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
        {tab === "Inventory" && jobId && (
          <BulkInventory
            jobId={jobId}
            onImport={(items) => {
              setDrafts(items);
              setImportRevision((n) => n + 1);
            }}
          />
        )}
        {tab === "Data quality" ? (
          <QualityView quality={quality} />
        ) : (
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
                    <small>{p.product_id}</small>
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
              {product &&
                (tab === "Inventory" ? (
                  <Inventory
                    key={product.product_id + importRevision}
                    product={product}
                    draft={drafts[product.product_id]}
                    result={result}
                    jobId={jobId}
                    saved={plans[product.product_id]}
                    onApply={(p) => onPlan(product.product_id, p)}
                    onExplain={onExplain}
                  />
                ) : (
                  <Forecast product={product} />
                ))}
            </div>
          </div>
        )}
      </section>
    </>
  );
}
function Forecast({ product: p }: { product: Product }) {
  const last = p.evaluation?.windows.at(-1);
  const history = p.history || [],
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
      <div className="detail-heading">
        <div>
          <h2>{p.name}</h2>
          <p className="muted">
            {p.product_id} · {p.usable_days} complete days of history
          </p>
        </div>
        <span className="badge">{p.status.replaceAll("_", " ")}</span>
      </div>
      {!future.length ? (
        <Notice tone="warning">
          {p.missing_days > 0
            ? `We need the missing ${p.missing_days} day(s) of sales before forecasting this product.`
            : p.status === "summary_only"
              ? "We need more sales history before forecasting this product."
              : "Some sales records need fixing before we can forecast this product. See Data quality for the details."}
        </Notice>
      ) : (
        <>
          <div className="metric-strip">
            <div>
              <small>Predicted sales · next 28 days</small>
              <strong>{num(p.forecast_total)} units</strong>
            </div>
            <div>
              <small>Sales history</small>
              <strong>{p.usable_days} days</strong>
            </div>
          </div>
          <svg
            className="live-chart"
            viewBox="0 0 740 260"
            role="img"
            aria-label="Historical sales in gray and forecast in green. Exact values are in the table below."
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
              Recent history
            </text>
            <text x="590" y="245">
              Forecast
            </text>
            <text x="5" y="215">
              0
            </text>
            <text x="5" y="45">
              {Math.ceil(max)}
            </text>
          </svg>
          <div className="forecast-confidence">
            <strong>
              {last
                ? `Past test: off by about ${num(last.model.mae)} units per day`
                : "Not enough history to test this forecast yet"}
            </strong>
            <p>
              {p.inventory_eligible
                ? "Stock planning is available for this product."
                : "Use this estimate cautiously. Stock recommendations need stronger evidence."}
            </p>
          </div>
          <details className="quiet-details">
            <summary>How reliable is this forecast?</summary>
            <p>
              We tested the method on past sales that were kept out of training.
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
            {p.forecast_warning && (
              <Notice tone="warning">{p.forecast_warning}</Notice>
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
                    · {last.start} – {last.end}
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
          <details className="panel">
            <summary>View daily forecast values</summary>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Predicted units</th>
                  </tr>
                </thead>
                <tbody>
                  {future.map((d) => (
                    <tr key={d.date}>
                      <td>{d.date}</td>
                      <td>{num(d.units)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </>
  );
}
