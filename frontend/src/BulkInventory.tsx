import { useState } from "react";
import { api, post, download, type Upload } from "./data";
import { Button, Notice } from "./UI";
export type InventoryDraft = Record<string, unknown> & {
  incoming: { id: string; date: string; units: number; status: string }[];
};
export default function BulkInventory({
  jobId,
  onImport,
}: {
  jobId: string;
  onImport: (items: Record<string, InventoryDraft>) => void;
}) {
  const [stock, setStock] = useState<File | null>(null),
    [orders, setOrders] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function run() {
    if (!stock) return;
    setBusy(true);
    setMessage("");
    try {
      const upload = (f: File) =>
        api<Upload>("/uploads?name=" + encodeURIComponent(f.name), {
          method: "POST",
          body: f,
        });
      const a = await upload(stock),
        b = orders ? await upload(orders) : null;
      const r = await post<{ products: Record<string, InventoryDraft> }>(
        `/jobs/${jobId}/inventory-import`,
        { inventory_upload_id: a.id, incoming_upload_id: b?.id },
      );
      onImport(r.products);
      setMessage(
        `${Object.keys(r.products).length} products matched. Select each product to review its imported settings before applying a plan.`,
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="panel">
      <summary>Have a stock file? Import it here</summary>
      <label className="field">
        Inventory CSV
        <input
          type="file"
          accept=".csv"
          onChange={(e) => setStock(e.target.files?.[0] || null)}
        />
      </label>
      <label className="field">
        Incoming orders CSV (optional)
        <input
          type="file"
          accept=".csv"
          onChange={(e) => setOrders(e.target.files?.[0] || null)}
        />
      </label>
      <div className="inline-actions">
        <Button disabled={!stock || busy} onClick={run}>
          {busy ? "Checking stock files…" : "Match inventory files"}
        </Button>
        <button
          className="text-link"
          onClick={() =>
            download(
              "inventory-template.csv",
              "product_id,available_units,as_of_date,lead_time_days,pack_size,minimum_order_units\n",
            )
          }
        >
          Inventory template
        </button>
        <button
          className="text-link"
          onClick={() =>
            download(
              "incoming-template.csv",
              "incoming_line_id,product_id,due_date,incoming_units,status\n",
            )
          }
        >
          Incoming template
        </button>
      </div>
      <p className="muted">
        Exact product IDs only. Incoming status may be open, received or
        cancelled; omit the column for open orders.
      </p>
      {message && <Notice>{message}</Notice>}
    </details>
  );
}
