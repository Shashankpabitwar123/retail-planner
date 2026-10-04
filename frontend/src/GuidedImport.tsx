import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Check } from "lucide-react";
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
}: {
  upload: Upload;
  guidance: Guidance | null;
  busy: boolean;
  onAnswer: (key: string, value: string) => void;
  onReset: () => void;
  onDetails: () => void;
}) {
  const q = guidance?.question;
  const [zone, setZone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC",
  );
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!busy) heading.current?.focus();
  }, [q?.id, guidance?.blocked, busy]);
  return (
    <section className="guided-card">
      <div className="file-chip">
        <Check size={16} />
        <span>{upload.row_count.toLocaleString()} sales rows found</span>
      </div>
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
          <p className="eyebrow">ONE QUICK QUESTION</p>
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
                  className="answer-option"
                  onClick={() => onAnswer(q.id, o.value)}
                >
                  <strong>{o.label}</strong>
                  {o.hint && <span>{o.hint}</span>}
                </button>
              ))}
            </div>
          )}
          <p className="muted question-footnote">
            We’ve taken care of everything else we can read from your file.
          </p>
          <button className="text-link" onClick={onReset}>
            Choose a different file
          </button>
        </>
      ) : (
        <Notice>Your file is ready. Preparing your analysis…</Notice>
      )}
    </section>
  );
}
