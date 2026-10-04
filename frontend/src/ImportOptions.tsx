import { useEffect, useState } from "react";
import {
  api,
  num,
  download,
  type Config,
  type Job,
  type Upload,
  type Quality,
} from "./data";
import { Notice } from "./UI";
export default function ImportOptions({
  config,
  onChange,
}: {
  config: Config;
  onChange: (c: Config) => void;
}) {
  const [error, setError] = useState(""),
    [jobs, setJobs] = useState<Job[]>([]),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api<Job[]>("/jobs")
      .then(setJobs)
      .catch(() => {});
  }, []);
  async function attach(
    file: File,
    key: "coverage_upload_id" | "date_status_upload_id",
  ) {
    setBusy(true);
    setError("");
    try {
      const u = await api<Upload>(
        "/uploads?name=" + encodeURIComponent(file.name),
        { method: "POST", body: file },
      );
      onChange({ ...config, [key]: u.id });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const update = (key: keyof Config, value: unknown) =>
    onChange({ ...config, [key]: value });
  return (
    <details className="panel">
      <summary>Additional data and import options</summary>
      <p>
        Use these when products started at different times, days were closed or
        out of stock, or you are replacing an earlier export.
      </p>
      {error && <Notice tone="warning">{error}</Notice>}
      {(["coverage", "date_status"] as const).map((kind) => {
        const key =
          kind === "coverage" ? "coverage_upload_id" : "date_status_upload_id";
        return (
          <div key={kind}>
            <label className="field">
              {kind === "coverage"
                ? "Product active dates CSV"
                : "Daily status CSV"}
              <input
                type="file"
                accept=".csv"
                disabled={busy}
                onChange={(e) => {
                  if (e.target.files?.[0]) attach(e.target.files[0], key);
                  e.target.value = "";
                }}
              />
            </label>
            <button
              className="text-link"
              onClick={() =>
                download(
                  kind + "-template.csv",
                  kind === "coverage"
                    ? "product_id,active_from,active_to\n"
                    : "product_id,date,date_status\n",
                )
              }
            >
              Download template
            </button>
            {config[key] && (
              <p>
                Attached.{" "}
                <button className="text-link" onClick={() => update(key, "")}>
                  Remove attachment
                </button>
              </p>
            )}
          </div>
        );
      })}
      <p className="muted">
        Status values: observed, zero_confirmed, closed, unknown,
        censored_stockout. Supporting files use YYYY-MM-DD. A coverage file must
        list every product; blank active_to means still active.
      </p>
      <label className="field">
        Compare against a previous data review
        <select
          value={config.compare_review_id || ""}
          onChange={(e) => update("compare_review_id", e.target.value)}
        >
          <option value="">No comparison</option>
          {jobs
            .filter((j) => j.kind === "normalize" && j.state === "completed")
            .map((j) => (
              <option key={j.id} value={j.id}>
                {new Date(j.created * 1000).toLocaleString()} ·{" "}
                {j.id.slice(0, 6)}
              </option>
            ))}
        </select>
      </label>
      <label className="field">
        Subtotal/product IDs to exclude (one per line)
        <textarea
          rows={2}
          value={(config.exclude_product_ids || []).join("\n")}
          onChange={(e) =>
            update(
              "exclude_product_ids",
              e.target.value
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean),
            )
          }
        />
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={!!config.allow_product_renames}
          onChange={(e) => update("allow_product_renames", e.target.checked)}
        />
        Different names under one product ID are confirmed renames, not
        different variants.
      </label>
      {config.layout === "transactions" && (
        <label className="field">
          Custom event labels (one source label = sale, return or cancellation
          per line)
          <textarea
            rows={3}
            placeholder={
              "completed = sale\nrefunded = return\nvoid = cancellation"
            }
            value={config.event_labels_text || ""}
            onChange={(e) => {
              const value = e.target.value;
              update("event_labels_text", value);
            }}
          />
        </label>
      )}
    </details>
  );
}
export function Comparison({ quality }: { quality: Quality }) {
  const c = quality.comparison;
  if (!c) return null;
  return (
    <section className="panel">
      <h2>Compared with the earlier upload</h2>
      <p>
        {num(c.identical_keys)} unchanged · {num(c.changed_keys)} changed ·{" "}
        {num(c.new_keys)} added · {num(c.removed_keys)} absent from the
        replacement.
      </p>
      <Notice>{c.action}</Notice>
      {c.changes.length > 0 && (
        <details>
          <summary>Show changed records (first 100)</summary>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Date</th>
                  <th>Earlier units</th>
                  <th>New units</th>
                </tr>
              </thead>
              <tbody>
                {c.changes.map((v, i) => (
                  <tr key={i}>
                    <td>{v.product_id}</td>
                    <td>{v.date}</td>
                    <td>{v.previous_units ?? "Unknown"}</td>
                    <td>{v.new_units ?? "Unknown"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}
