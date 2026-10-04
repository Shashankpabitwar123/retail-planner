import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Button, Notice } from "./UI";
import type { Config, Upload } from "./data";
export type Guidance = {
  ready: boolean;
  config: Config;
  blocked?: string;
  question?: {
    id: string;
    title: string;
    detail: string;
    input?: string;
    options: { value: string; label: string; hint: string }[];
  } | null;
};
export default function GuidedImport({
  upload,
  guidance,
  busy,
  onAnswer,
  onReset,
  onDetails,
  previousAnswer,
  onPrevious,
  onSuggest,
}: {
  upload: Upload;
  guidance: Guidance | null;
  busy: boolean;
  onAnswer: (key: string, value: string) => void;
  onReset: () => void;
  onDetails: () => void;
  previousAnswer?: string;
  onPrevious?: () => void;
  onSuggest?: () => Promise<string | undefined>;
}) {
  const q = guidance?.question;
  const [selected, setSelected] = useState(previousAnswer || "");
  const [suggesting, setSuggesting] = useState(false);
  const [suggestion, setSuggestion] = useState("");
  useEffect(() => { setSelected(previousAnswer || ""); setSuggestion(""); }, [q?.id, previousAnswer]);
  const [zone, setZone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC",
  );
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (previousAnswer && q?.input === "timezone") setZone(previousAnswer); }, [q?.id, previousAnswer]);
  useEffect(() => {
    if (!busy) heading.current?.focus();
  }, [q?.id, guidance?.blocked, busy]);
  return (
    <section className="guided-card">
      {onPrevious && <Button variant="text" disabled={busy} onClick={onPrevious}>← Previous question</Button>}
      {!guidance || busy ? (
        <div role="status" className="guided-loading">
          <LoaderCircle className="spin" />
          <h1>Reading your sales file.</h1>
          <p>We’re finding your products, dates and sales quantities.</p>
        </div>
      ) : guidance.blocked ? (
        <>
          <h1 ref={heading} tabIndex={-1}>
            We need a little more information.
          </h1>
          <p>{guidance.blocked}</p>
          <Button onClick={onReset}>Choose another file</Button>
          <a
            className="text-link guided-secondary"
            href="/samples/01-daily.csv"
            download
          >
            Download an example CSV
          </a>
          <button className="text-link guided-secondary" onClick={onDetails}>
            Import details
          </button>
        </>
      ) : q ? (
        <>
          <p className="eyebrow">HELP US UNDERSTAND YOUR SALES</p>
          <h1 ref={heading} tabIndex={-1}>
            {q.title}
          </h1>
          <p className="question-detail">{q.detail}</p>
          {q.input === "timezone" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                onAnswer(q.id, zone);
              }}
            >
              <label className="field">
                Store time zone
                <input
                  value={zone}
                  onChange={(e) => setZone(e.target.value)}
                  list="store-zones"
                  required
                />
              </label>
              <datalist id="store-zones">
                {[
                  "America/New_York",
                  "America/Chicago",
                  "America/Denver",
                  "America/Los_Angeles",
                  "Europe/London",
                  "Europe/Paris",
                  "Asia/Kolkata",
                  "Asia/Tokyo",
                  "Australia/Sydney",
                  "Etc/UTC",
                ].map((z) => (
                  <option key={z} value={z} />
                ))}
              </datalist>
              <Button type="submit">Continue</Button>
            </form>
          ) : (
            <div className="answer-options">
              {q.options.map((o) => (
                <button
                  key={o.value}
                  className={"answer-option" + (selected === o.value ? " answer-selected" : "")}
                  aria-pressed={selected === o.value}
                  onClick={() => setSelected(o.value)}
                >
                  <strong>{o.label}</strong>
                  {o.hint && <span>{o.hint}</span>}
                </button>
              ))}
            </div>
          )}
          {q.input !== "timezone" && <Button disabled={!selected || suggesting} onClick={() => onAnswer(q.id, selected)}>Continue</Button>}
          {onSuggest && q.id.includes("column_") && <details className="question-ai"><summary>Need help choosing?</summary>
            <p>AI can suggest a heading. Only column names are shared with OpenAI, not your sales records. You review the answer before continuing.</p>
            <Button variant="secondary" disabled={suggesting} onClick={async () => {setSuggesting(true); try {const value = await onSuggest(); setSuggestion(value ? `Suggested heading: ${value}. Check its examples before choosing.` : "AI couldn’t find a clear match. Use the examples above.");} catch {setSuggestion("AI is unavailable. You can still choose using the examples above.");} finally {setSuggesting(false);} }}>{suggesting ? "Checking headings…" : "Share headings and suggest"}</Button>
            {suggestion && <p role="status">{suggestion}</p>}
          </details>}
          <details className="question-file-details"><summary>File details</summary><p>{upload.row_count.toLocaleString()} sales records found.</p></details>

        </>
      ) : (
        <Notice>Your file is ready. Preparing your analysis…</Notice>
      )}
    </section>
  );
}
