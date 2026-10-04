import { useState, useEffect } from "react";
import { Button, Notice } from "./UI";
import {
  post,
  num,
  csv,
  download,
  type Product,
  type Plan,
  type Result,
} from "./data";
export default function Inventory({
  product,
  result,
  jobId,
  onApply,
  onExplain,
  saved,
  draft,
}: {
  product: Product;
  result: Result;
  jobId: string | null;
  onApply: (p: Plan) => Promise<void>;
  onExplain: (p: Plan) => void;
  saved?: Plan;
  draft?: import("./BulkInventory").InventoryDraft;
}) {
  const [applying, setApplying] = useState(false);
  useEffect(() => {
    setPreview(null);
  }, [saved]);
  const defaults: Record<string, string> = {
    stock: "",
    snapshot_date: result.forecast_start,
    lead_days: "5",
    review_days: "7",
    buffer_days: "2",
    pack_size: "1",
    minimum_order: "0",
    mode: "historical_replay",
  };
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(defaults).map(([key, value]) => [
        key,
        String(draft?.[key] ?? saved?.assumptions[key] ?? value),
      ]),
    ),
  );
  const [incoming, setIncoming] = useState<
    { id: string; date: string; units: string; status: string }[]
  >(() =>
    Array.isArray(draft?.incoming || saved?.assumptions.incoming)
      ? (
          (draft?.incoming || saved?.assumptions.incoming) as {
            id: string;
            date: string;
            units: number;
            status: string;
          }[]
        )
          .filter(
            (o) =>
              o &&
              typeof o.id === "string" &&
              typeof o.date === "string" &&
              typeof o.units === "number",
          )
          .map((o) => ({
            id: o.id,
            date: o.date,
            units: String(o.units),
            status: o.status || "open",
          }))
      : [],
  );
  const [confirmed, setConfirmed] = useState(false);
  const [preview, setPreview] = useState<Plan | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const change = (k: string, v: string) => {
    setValues({ ...values, [k]: v });
    setPreview(null);
    setConfirmed(false);
  };
  async function calculate() {
    setError("");
    setBusy(true);
    try {
      const settings: Record<string, unknown> = {
        ...values,
        confirmed,
        product_id: product.product_id,
        incoming: incoming.map((o) => ({ ...o, units: Number(o.units) })),
      };
      for (const k of [
        "stock",
        "lead_days",
        "review_days",
        "buffer_days",
        "pack_size",
        "minimum_order",
      ])
        settings[k] = values[k] === "" ? null : Number(values[k]);
      setPreview(await post<Plan>(`/jobs/${jobId}/inventory`, settings));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function exportPlan(p: Plan) {
    download(
      "inventory-plan.csv",
      csv([
        [
          "product_id",
          "product_name",
          "planning_mode",
          "planning_date",
          "arrival_date",
          "suggested_order_units",
          "unmet_units_before_arrival",
          "assumptions",
        ],
        [
          product.product_id,
          product.name,
          p.mode,
          p.planning_date,
          p.arrival_date,
          p.suggested_order_units,
          p.pre_arrival_unmet_units,
          JSON.stringify(p.assumptions),
        ],
      ]),
    );
  }
  return (
    <section>
      <h2>Plan stock for {product.name}</h2>
      {saved && (
        <Notice tone="success">
          Saved plan: {num(saved.suggested_order_units)} units, arriving{" "}
          {saved.arrival_date}.{" "}
          <button className="text-link" onClick={() => exportPlan(saved)}>
            Download plan
          </button>
        </Notice>
      )}
      {saved && <StockProjection plan={saved} />}
      {!jobId ? (
        <Notice>
          This is a restored result. Re-upload its sales data to calculate a new
          inventory scenario. Saved plans can still be downloaded.
        </Notice>
      ) : !product.inventory_eligible ? (
        <Notice tone="warning">
          {product.forecast_warning ||
            "A completed historical forecast test is required before we recommend stock for this product."}
        </Notice>
      ) : (
        <>
          <Notice>
            Add your stock and delivery time to see how much you may need. This
            creates a plan; it won’t place an order.
          </Notice>
          <div className="inventory-grid">
            {Object.entries({
              stock: "How many units are in stock?",
              snapshot_date: "Stock count date",
              lead_days: "How many days does delivery take?",
            }).map(([k, label]) => (
              <label className="field" key={k}>
                {label}
                <input
                  type={k === "snapshot_date" ? "date" : "number"}
                  min={
                    ["lead_days", "review_days", "pack_size"].includes(k)
                      ? 1
                      : 0
                  }
                  step="1"
                  value={values[k]}
                  onChange={(e) => change(k, e.target.value)}
                />
              </label>
            ))}
          </div>
          <p className="muted">
            Plan for {values.review_days} days of sales, plus a{" "}
            {values.buffer_days}-day buffer. Orders in packs of{" "}
            {values.pack_size}; minimum {values.minimum_order} units.
          </p>
          <details className="quiet-details">
            <summary>Adjust the plan</summary>
            <div className="inventory-grid">
              {Object.entries({
                review_days: "Days to cover",
                buffer_days: "Extra buffer days",
                pack_size: "Units per pack",
                minimum_order: "Minimum order",
              }).map(([k, label]) => (
                <label className="field" key={k}>
                  {label}
                  <input
                    type="number"
                    min={["review_days", "pack_size"].includes(k) ? 1 : 0}
                    value={values[k]}
                    onChange={(e) => change(k, e.target.value)}
                  />
                </label>
              ))}
              <label className="field">
                Planning mode
                <select
                  value={values.mode}
                  onChange={(e) => change("mode", e.target.value)}
                >
                  <option value="historical_replay">Plan using these sales dates</option>
                  <option value="current">Plan for today</option>
                </select>
              </label>
            </div>
          </details>
          <details
            className="quiet-details"
            open={incoming.length > 0 || undefined}
          >
            <summary>
              Stock already on its way{" "}
              {incoming.length > 0 ? `(${incoming.length})` : ""}
            </summary>
            <h3>Incoming stock</h3>
            <p className="muted">
              Only open orders arriving in the relevant period reduce the
              recommendation. Leave empty if none are incoming.
            </p>
            {incoming.map((o, i) => (
              <div className="incoming-row" key={i}>
                {(["id", "date", "units"] as const).map((k) => (
                  <label className="field" key={k}>
                    {k === "id"
                      ? "Order ID"
                      : k === "date"
                        ? "Due date"
                        : "Units"}
                    <input
                      type={
                        k === "date"
                          ? "date"
                          : k === "units"
                            ? "number"
                            : "text"
                      }
                      value={o[k]}
                      onChange={(e) => {
                        setIncoming(
                          incoming.map((r, j) =>
                            i === j ? { ...r, [k]: e.target.value } : r,
                          ),
                        );
                        setPreview(null);
                        setConfirmed(false);
                      }}
                    />
                  </label>
                ))}
                <label className="field">
                  Status
                  <select
                    value={o.status}
                    onChange={(e) => {
                      setIncoming(
                        incoming.map((r, j) =>
                          i === j ? { ...r, status: e.target.value } : r,
                        ),
                      );
                      setPreview(null);
                      setConfirmed(false);
                    }}
                  >
                    <option value="open">Open</option>
                    <option value="received">Already received</option>
                    <option value="cancelled">Canceled</option>
                  </select>
                </label>
                <Button
                  variant="text"
                  onClick={() => {
                    setIncoming(incoming.filter((_, j) => i !== j));
                    setPreview(null);
                    setConfirmed(false);
                  }}
                >
                  Remove
                </Button>
              </div>
            ))}
            <Button
              variant="secondary"
              onClick={() => {
                setIncoming([
                  ...incoming,
                  {
                    id: "",
                    date: result.forecast_start,
                    units: "",
                    status: "open",
                  },
                ]);
                setPreview(null);
                setConfirmed(false);
              }}
            >
              + Add incoming order
            </Button>
          </details>
          <label className="check-row">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => {
                setConfirmed(e.target.checked);
                setPreview(null);
              }}
            />
            This product is still sold. The stock count and any incoming orders
            above are correct.
          </label>
          {error && <Notice tone="warning">{error}</Notice>}
          <Button onClick={calculate} disabled={!confirmed || busy}>
            {busy ? "Calculating…" : "Calculate restock amount"}
          </Button>
          {preview && (
            <section className="panel scenario">
              <p className="eyebrow">YOUR RESTOCK ESTIMATE</p>
              <p className="muted">Plan date: {preview.planning_date}. This is a recommendation; no order is placed.</p>
              <h2>{preview.suggested_order_units > 0 ? `${num(preview.suggested_order_units)} units to restock` : "No extra stock needed for this plan"}</h2>
              <p>
                Expected delivery: {preview.arrival_date}. Sales you may miss before delivery:{" "}
                <strong>{num(preview.pre_arrival_unmet_units)} units</strong>
                {preview.first_shortfall_date
                  ? `, starting ${preview.first_shortfall_date}`
                  : ""}
                .
              </p>
              <p className="muted">{preview.notice}</p>
              <details className="quiet-details"><summary>How this amount was calculated</summary><p>Includes {num(preview.buffer_units)} units of buffer stock. Estimated stock remaining at the end of the plan: {num(preview.end_protection_stock_with_order)} units.</p></details>
              <StockProjection plan={preview} />
              <Button variant="secondary" onClick={() => onExplain(preview)}>
                Ask about this plan
              </Button>
              <Button
                disabled={applying}
                onClick={async () => {
                  setApplying(true);
                  try {
                    await onApply(preview);
                  } finally {
                    setApplying(false);
                  }
                }}
              >
                Save this plan
              </Button>
            </section>
          )}
        </>
      )}
    </section>
  );
}

function StockProjection({ plan }: { plan: Plan }) {
  if (!plan.daily_stock) return null;
  return (
    <details>
      <summary>Daily stock projection with this proposed order</summary>
      <p>
        Simulated from sales forecasts, not actual future demand. The order
        covers the selected review period; later days can need another review.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Opening</th>
              <th>Incoming</th>
              <th>Proposed receipt</th>
              <th>Forecast sales</th>
              <th>Unmet</th>
              <th>Closing</th>
            </tr>
          </thead>
          <tbody>
            {plan.daily_stock.map((d) => (
              <tr key={d.date}>
                <td>{d.date}</td>
                <td>{num(d.opening_units)}</td>
                <td>{num(d.incoming_units)}</td>
                <td>{num(d.proposed_receipt_units)}</td>
                <td>{num(d.forecast_units)}</td>
                <td>{num(d.unmet_units)}</td>
                <td>{num(d.closing_units)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
