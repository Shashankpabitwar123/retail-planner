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
    suggested_value?: string;
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

}: {
  upload: Upload;
  guidance: Guidance | null;
  busy: boolean;
  onAnswer: (key: string, value: string) => void;
  onReset: () => void;
  onDetails: () => void;
  previousAnswer?: string;
  onPrevious?: () => void;

}) {
  const q = guidance?.question;
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
                  className={"answer-option" + (q.suggested_value === o.value ? " answer-suggested" : "")}
                  disabled={busy}
                  onClick={() => onAnswer(q.id, o.value)}
                >
                  <strong>{o.label}{q.suggested_value === o.value && <small className="suggested-label">Suggested</small>}</strong>
                  {o.hint && <span>{o.hint}</span>}
                </button>
              ))}
            </div>
          )}


        </>
      ) : (
        <Notice>Your file is ready. Preparing your analysis…</Notice>
      )}
      {!busy && guidance && <div className="question-back"><Button variant="text" onClick={onPrevious || onReset}>← Back</Button></div>}
    </section>
  );
}
