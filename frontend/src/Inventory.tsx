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
  onExplain:(p:Plan)=>void;
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
          Saved scenario: {num(saved.suggested_order_units)} units, arriving{" "}
          {saved.arrival_date}.{" "}
          <button className="text-link" onClick={() => exportPlan(saved)}>
            Download saved order plan
          </button>
        </Notice>
      )}
      {saved&&<StockProjection plan={saved}/>}
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
            This is a planning estimate, not a purchase order. Historical replay
            lets you test the decision at the forecast date. For current
            planning, sales must run through yesterday.
          </Notice>
          <div className="inventory-grid">
            {Object.entries({
              stock: "Units available",
              snapshot_date: "Snapshot at start of",
              lead_days: "Lead time (days)",
              review_days: "Review period (days)",
              buffer_days: "Buffer (days)",
              pack_size: "Pack size",
              minimum_order: "Minimum order",
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
            <label className="field">
              Planning mode
              <select
                value={values.mode}
                onChange={(e) => change("mode", e.target.value)}
              >
                <option value="historical_replay">Historical replay</option>
                <option value="current">Current planning</option>
              </select>
            </label>
          </div>
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
                      k === "date" ? "date" : k === "units" ? "number" : "text"
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
          <label className="check-row">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => {
                setConfirmed(e.target.checked);
                setPreview(null);
              }}
            />
            This product is active. I confirmed stock, open incoming orders and
            these planning assumptions.
          </label>
          {error && <Notice tone="warning">{error}</Notice>}
          <Button onClick={calculate} disabled={!confirmed || busy}>
            {busy ? "Calculating…" : "Preview order plan"}
          </Button>
          {preview && (
            <section className="panel scenario">
              <p className="eyebrow">SCENARIO PREVIEW</p>
              <h2>{num(preview.suggested_order_units)} units to order</h2>
              <p>
                Arrive on {preview.arrival_date}. Estimated unmet sales before
                arrival:{" "}
                <strong>{num(preview.pre_arrival_unmet_units)} units</strong>
                {preview.first_shortfall_date
                  ? `, starting ${preview.first_shortfall_date}`
                  : ""}
                .
              </p>
              <p>
                Buffer: {num(preview.buffer_units)} units. Stock after the
                review period: {num(preview.end_protection_stock_with_order)}{" "}
                units.
              </p>
              <p className="muted">{preview.notice}</p>
              <StockProjection plan={preview}/>
              <Button variant="secondary" onClick={()=>onExplain(preview)}>Ask about this preview</Button>
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
                Apply this scenario
              </Button>
            </section>
          )}
        </>
      )}
    </section>
  );
}

function StockProjection({plan}:{plan:Plan}){if(!plan.daily_stock)return null;return <details><summary>Daily stock projection with this proposed order</summary><p>Simulated from sales forecasts, not actual future demand. The order covers the selected review period; later days can need another review.</p><div className="table-scroll"><table><thead><tr><th>Date</th><th>Opening</th><th>Incoming</th><th>Proposed receipt</th><th>Forecast sales</th><th>Unmet</th><th>Closing</th></tr></thead><tbody>{plan.daily_stock.map(d=><tr key={d.date}><td>{d.date}</td><td>{num(d.opening_units)}</td><td>{num(d.incoming_units)}</td><td>{num(d.proposed_receipt_units)}</td><td>{num(d.forecast_units)}</td><td>{num(d.unmet_units)}</td><td>{num(d.closing_units)}</td></tr>)}</tbody></table></div></details>}
