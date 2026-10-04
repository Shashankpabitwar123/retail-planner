import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Clock3,
  MessageSquare,
  UploadCloud,
  Check,
  LoaderCircle,
} from "lucide-react";
import { Button, Notice, Steps } from "./UI";
import { Setup, QualityView } from "./Review";
import Results from "./Results";
import GuidedImport, { type Guidance } from "./GuidedImport";
import {
  api,
  post,
  num,
  friendlyDate,
  download,
  backup,
  restore,
  historyList,
  historySave,
  historyDelete,
  type Config,
  type Upload,
  type Job,
  type Quality,
  type Result,
  type Snapshot,
  type Plan,
} from "./data";
function uniqueEvidenceLinks(sources: string[]) {
  const destination = (source: string) => source === "rows" ? "rows" : source === "quality" ? "quality" : ["inventory", "scenario"].includes(source) ? "inventory" : "forecast";
  const seen = new Set<string>();
  return sources.filter(source => {
    const target = destination(source);
    if (seen.has(target)) return false;
    seen.add(target);
    return true;
  });
}
const initial: Config = {
  mapping: {},
  layout: "daily",
  date_format: "ISO",
  number_format: "dot",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC",
  coverage_start: "",
  coverage_end: "",
  coverage_confirmed: false,
  gross_sales_confirmed: false,
  missing_days_zero: false,
  deduplicate_events: false,
  store_id: "",
};
export default function App() {
  const [guidance, setGuidance] = useState<Guidance | null>(null);
  const [guideAnswers, setGuideAnswers] = useState<Record<string, string>>({});
  const automatic = useRef(true);
  const importGeneration = useRef(0);
  const missingAnswered = useRef(false);
  const [missingQuestion, setMissingQuestion] = useState(false);
  const [rowEvidence, setRowEvidence] = useState<
    | {
        date: string;
        product_id: string;
        units_sold: number | null;
        observation_status: string;
      }[]
    | null
  >(null);
  const [rowError, setRowError] = useState("");
  const [previewContext, setPreviewContext] = useState<Plan | null>(null);
  const [serverPolicy, setServerPolicy] = useState({
    max_upload_bytes: 10485760,
    max_rows: 200000,
    max_products: 500,
    ephemeral: false,
    ai_available: false,
  });
  const [phase, setPhase] = useState("upload"),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [toast, setToast] = useState("");
  const [upload, setUpload] = useState<Upload | null>(null),
    [name, setName] = useState("Sales analysis"),
    [config, setConfig] = useState<Config>(initial),
    [jobId, setJobId] = useState<string | null>(null),
    [job, setJob] = useState<Job | null>(null),
    [reviewId, setReviewId] = useState<string | null>(null),
    [review, setReview] = useState<Quality | null>(null),
    [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [serverId, setServerId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<"help" | "history" | null>(null),
    [history, setHistory] = useState<Snapshot[]>([]),
    [jobs, setJobs] = useState<Job[]>([]),
    [selected, setSelected] = useState(""),
    [subset, setSubset] = useState(false);
  const [question, setQuestion] = useState(""),
    [consent, setConsent] = useState(false),
    [answer, setAnswer] = useState(""),
    [citations, setCitations] = useState<string[]>([]),
    [asking, setAsking] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null),
    backupInput = useRef<HTMLInputElement>(null),
    main = useRef<HTMLElement>(null);
  const completed = useRef("");
  const [pollRevision, setPollRevision] = useState(0);
  const [requestedTab, setRequestedTab] = useState<{
    name: string;
    revision: number;
  }>({ name: "Forecasts", revision: 0 });
  const [conversation, setConversation] = useState<
    { question: string; answer: string; citations: string[]; created: number }[]
  >([]);
  const [ackChanges, setAckChanges] = useState(false);
  const activePid = selected || review?.products[0]?.product_id || "";
  const chatProduct = snapshot?.result.products.find(p => p.product_id === activeProductId()) || review?.products.find(p => p.product_id === activeProductId());
  function activeProductId() { return selected || review?.products[0]?.product_id || ""; }
  const warningQuestions = [
    ...(chatProduct && phase === "results" && !chatProduct.forecast?.length ? ["Why is the forecast unavailable for this product?"] : []),
    ...(chatProduct && phase === "results" && !chatProduct.inventory_eligible ? ["Why can’t I get a restock recommendation?", "What data do I need to add or fix?"] : []),
    ...(chatProduct?.missing_days ? ["Which sales days are missing?"] : []),
    ...((review?.issues.length || snapshot?.result.quality.issues.length) ? ["Explain the warnings for this product."] : []),
  ];
  const chatEnd = useRef<HTMLDivElement>(null);
  const contextRef = useRef("");
  const liveContext =
    phase === "results" ? serverId : phase === "review" ? reviewId : null;
  contextRef.current = String(liveContext) + ":" + activePid;
  useEffect(() => {
    if (drawer === "help") chatEnd.current?.scrollIntoView({ block: "nearest" });
  }, [conversation, answer, asking]);
  function evidenceLink(source: string, sourceQuestion = question) {
    if (source === "rows") {
      const dates = [
        ...new Set(sourceQuestion.match(/\b\d{4}-\d{2}-\d{2}\b/g) || []),
      ].sort();
      if (!dates.length) {
        setRowError("Include a YYYY-MM-DD date to open its normalized rows.");
        return;
      }
      const context = contextRef.current;
      setRowEvidence(null);
      setRowError("");
      api<NonNullable<typeof rowEvidence>>(
        `/jobs/${liveContext}/rows?product_id=${encodeURIComponent(activePid)}&start=${dates[0]}&end=${dates.at(-1)}`,
      )
        .then((r) => {
          if (contextRef.current === context) setRowEvidence(r);
        })
        .catch((e) => {
          if (contextRef.current === context) setRowError(e.message);
        });
      return;
    }
    setDrawer(null);
    setRequestedTab({
      name:
        source === "inventory" || source === "scenario"
          ? "Inventory"
          : source === "quality" || source === "rows"
            ? "Data quality"
            : "Forecasts",
      revision: Date.now(),
    });
  }
  useEffect(() => {
    let current = true;
    setConversation([]);
    setPreviewContext(null);
    setRowEvidence(null);
    setRowError("");
    setAnswer("");
    setAsking(false);
    if (liveContext)
      api<typeof conversation>(
        `/jobs/${liveContext}/messages?product_id=${encodeURIComponent(activePid)}`,
      )
        .then((v) => {
          if (current) setConversation(v);
        })
        .catch(() => {});
    return () => {
      current = false;
    };
  }, [liveContext, activePid]);
  useEffect(() => {
    api<typeof serverPolicy>("/session")
      .then((policy) => {
        setServerPolicy(policy);
        setReady(true);
        const saved = localStorage.getItem("retail-active-job");
        if (saved) {
          setPhase("processing");
          setJobId(saved);
        }
      })
      .catch((e) => setError(e.message));
    historyList()
      .then(setHistory)
      .catch((e) => setToast(e.message));
  }, []);
  useEffect(() => {
    if (!document.querySelector("dialog[open]")) {
      main.current?.focus();
      window.scrollTo(0, 0);
    }
  }, [phase]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 8000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    setAnswer("");
    setCitations([]);
  }, [liveContext, selected]);
  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await api<Job>(`/jobs/${jobId}`);
        if (stopped) return;
        setJob(next);
        setError("");
        if (
          next.kind === "normalize" &&
          ["completed", "failed", "canceled"].includes(next.state) &&
          upload?.id !== next.upload
        ) {
          const source = await api<Upload>(`/uploads/${next.upload}`);
          if (stopped) return;
          setUpload(source);
          if (next.settings) setConfig(next.settings);
        }
        if (next.state === "completed" && next.result) {
          if (completed.current === next.id) return;
          completed.current = next.id;
          if (next.kind === "normalize") {
            setReviewId(next.id);
            setReview(next.result as Quality);
            setConfig((next.result as Quality).config);
            setSubset(false);
            setAckChanges(false);
            const quality = next.result as Quality;
            const changed =
              quality.comparison?.changed_keys ||
              quality.comparison?.removed_keys;
            if (changed) automatic.current = false;
            if (automatic.current && !changed) {
              if (
                !quality.global_block &&
                quality.products.some((p) => p.missing_days > 0) &&
                !missingAnswered.current &&
                !quality.config.missing_days_zero
              ) {
                setMissingQuestion(true);
                setPhase("review");
              } else if (
                quality.eligible_products > 0 &&
                !quality.global_block
              ) {
                try {
                  const f = await post<{ id: string }>(
                    `/jobs/${next.id}/forecast`,
                  );
                  if (!stopped) start(f.id);
                } catch (e) {
                  if (!stopped) {
                    setError((e as Error).message);
                    setPhase("review");
                  }
                }
              } else setPhase("review");
            } else setPhase("review");
          } else {
            const result = next.result as Result;
            const existing = await historyList()
              .then((items) => items.find((s) => s.id === next.id))
              .catch(() => undefined);
            const applied = await api<{ product_id: string; plan: Plan }[]>(
              `/jobs/${next.id}/plans`,
            ).catch(() => []);
            const serverPlans = Object.fromEntries(
              [...applied].reverse().map((v) => [v.product_id, v.plan]),
            );
            const saved: Snapshot = {
              id: next.id,
              created: new Date(next.created * 1000).toISOString(),
              name: next.source_name || existing?.name || name,
              digest:
                next.source_digest || existing?.digest || upload?.digest || "",
              result,
              plans: { ...(existing?.plans || {}), ...serverPlans },
            };
            setSnapshot(saved);
            setServerId(next.id);
            setSelected(
              result.products.find((p) => p.forecast?.length)?.product_id ||
                result.products[0]?.product_id ||
                "",
            );
            setPhase("results");
            await historySave(saved)
              .then((summary) => {
                if (summary)
                  setToast(
                    "Only a summary fits in browser history. Download your full workspace to keep the daily details.",
                  );
                return historyList().then(setHistory);
              })
              .catch((e) => setToast(e.message));
          }
          return;
        }
        if (["failed", "canceled"].includes(next.state)) return;
        timer = setTimeout(poll, 700);
      } catch (e) {
        if (stopped) return;
        setError((e as Error).message);
        if ([401, 404].includes((e as Error & { status: number }).status)) {
          localStorage.removeItem("retail-active-job");
          setJobId(null);
          setJob(null);
          setServerId(null);
          setReviewId(null);
          setPhase("upload");
          await api<typeof serverPolicy>("/session")
            .then(setServerPolicy)
            .catch(() => {});
          return;
        }
        timer = setTimeout(poll, 3000);
      }
    }
    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [jobId, pollRevision]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function start(id: string) {
    completed.current = "";
    setPollRevision((n) => n + 1);
    setJob(null);
    setJobId(id);
    localStorage.setItem("retail-active-job", id);
    setPhase("processing");
  }
  async function loadFile(file: File) {
    const generation = ++importGeneration.current;
    await run(async () => {
      if (file.size > serverPolicy.max_upload_bytes)
        throw Error(
          `This file is larger than ${serverPolicy.max_upload_bytes / 1024 / 1024} MB. Export fewer products or remove unnecessary columns, then upload the smaller CSV. Keep the sales history for each product together.`,
        );
      const u = await api<Upload>(
        "/uploads?name=" + encodeURIComponent(file.name),
        { method: "POST", body: file },
      );
      if (generation !== importGeneration.current) return;
      setUpload(u);
      setName(file.name);
      automatic.current = true;
      missingAnswered.current = false;
      setMissingQuestion(false);
      setGuideAnswers({});
      setGuidance(null);
      setReview(null);
      setReviewId(null);
      setJobId(null);
      localStorage.removeItem("retail-active-job");
      setPhase("guide");
      await inspectGuide(u, {});
    });
  }
  async function inspectGuide(u: Upload, answers: Record<string, string>) {
    const generation = importGeneration.current;
    const result = await post<Guidance>(`/uploads/${u.id}/guide`, {
      answers,
      timezone: initial.timezone,
    });
    if (generation !== importGeneration.current) return;
    setGuidance(result);
    setConfig(result.config);
    if (result.ready) {
      const r = await post<{ id: string }>(
        `/uploads/${u.id}/review`,
        result.config,
      );
      if (generation === importGeneration.current) start(r.id);
    }
  }
  async function answerGuide(key: string, value: string) {
    if (!upload) return;
    const answers = { ...guideAnswers, [key]: value };
    setGuideAnswers(answers);
    await run(() => inspectGuide(upload, answers));
  }
  async function answerMissing(zero: boolean) {
    missingAnswered.current = true;
    setMissingQuestion(false);
    if (zero && upload && review) {
      await run(async () => {
        const cfg = { ...review.config, missing_days_zero: true };
        setConfig(cfg);
        const r = await post<{ id: string }>(
          `/uploads/${upload.id}/review`,
          cfg,
        );
        start(r.id);
      });
    } else if (review?.eligible_products && !review.global_block) {
      await run(async () => {
        const r = await post<{ id: string }>(`/jobs/${reviewId}/forecast`);
        start(r.id);
      });
    }
  }
  async function sample(file: string) {
    await run(async () => {
      const response = await fetch("/samples/" + file);
      if (!response.ok) throw Error("Sample unavailable.");
      await loadFile(
        new File([await response.blob()], file, { type: "text/csv" }),
      );
    });
  }
  function reset() {
    importGeneration.current++;
    setJobId(null);
    localStorage.removeItem("retail-active-job");
    setPhase("upload");
    setUpload(null);
    setSnapshot(null);
    setServerId(null);
    setReviewId(null);
    setReview(null);
    setError("");
    setDrawer(null);
  }
  async function persist(s: Snapshot) {
    setSnapshot(s);
    await historySave(s)
      .then((summary) => {
        if (summary)
          setToast(
            "Only a summary fits in browser history. Download your full workspace to keep the daily details.",
          );
        return historyList().then(setHistory);
      })
      .catch((e) => setToast(e.message));
  }
  function openSaved(s: Snapshot) {
    setJobId(null);
    localStorage.removeItem("retail-active-job");
    setSnapshot(s);
    setServerId(null);
    setSelected(
      s.result.products.find((p) => p.forecast?.length)?.product_id ||
        s.result.products[0]?.product_id ||
        "",
    );
    setPhase(s.summaryOnly ? "summary" : "results");
    setDrawer(null);
    setError("");
    setToast(
      "Opened saved results. Re-upload the source file for new calculations or live AI. No raw CSV is stored in this backup.",
    );
  }
  async function ask(q: string) {
    if (!consent || asking || !liveContext || !q.trim()) return;
    const sourceContext = contextRef.current;
    setQuestion(q);
    setAsking(true);
    setAnswer("");
    setCitations([]);
    try {
      const data = await post<{ answer: string; citations: string[] }>(
        `/jobs/${liveContext}/ask`,
        {
          question: q,
          product_id: selected || review?.products[0]?.product_id,
          consent,
          ...(previewContext ? { preview: previewContext.assumptions } : {}),
        },
      );
      if (contextRef.current !== sourceContext) return;
      setAnswer(data.answer);
      setCitations(data.citations);
      const messages = await api<typeof conversation>(
        `/jobs/${liveContext}/messages?product_id=${encodeURIComponent(activePid)}`,
      );
      if (contextRef.current !== sourceContext) return;
      setConversation(messages);
      setQuestion("");
      if (messages.at(-1)?.question === q) setAnswer("");
    } catch (e) {
      if (contextRef.current === sourceContext) setAnswer((e as Error).message);
    } finally {
      if (contextRef.current === sourceContext) setAsking(false);
    }
  }
  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <button className="wordmark" onClick={reset}>
          Retail Planner
        </button>
        <nav aria-label="Main navigation">
          <Button variant="secondary" onClick={reset}>
            New analysis
          </Button>
          <button
            id="history-trigger"
            className="nav-button"
            onClick={() => {
              setDrawer("history");
              api<Job[]>("/jobs")
                .then(setJobs)
                .catch((e) => setToast(e.message));
            }}
          >
            <Clock3 size={17} />
            History
          </button>
        </nav>
      </header>
      <main id="main" tabIndex={-1} ref={main} className="main live-main">
        {error && (
          <div role="alert">
            <Notice tone="warning">
              {error}
              {phase === "guide" && upload && !busy && (
                <Button
                  variant="text"
                  onClick={() => run(() => inspectGuide(upload, guideAnswers))}
                >
                  Try again
                </Button>
              )}
              {!ready && (
                <Button variant="text" onClick={() => location.reload()}>
                  Reconnect
                </Button>
              )}
            </Notice>
          </div>
        )}
        {phase === "upload" && (
          <>
            <div className="page-heading">
              <p className="eyebrow">LESS GUESSWORK. BETTER STOCK DECISIONS.</p>
              <h1>Know what to stock next.</h1>
              <p>
                Turn your store’s sales history into a practical forecast.
                <br />
                Upload your sales file. We’ll take care of the rest.
              </p>
            </div>
            <div className="live-columns">
              <section
                className="upload-box"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (ready && !busy && e.dataTransfer.files[0])
                    loadFile(e.dataTransfer.files[0]);
                }}
              >
                <UploadCloud size={32} strokeWidth={1.5} />
                <h2>Upload your sales file</h2>
                <p>Drop your CSV file here, or choose a file.</p>
                <Button
                  disabled={!ready || busy}
                  onClick={() => fileInput.current?.click()}
                >
                  {busy ? "Reading your file…" : "Choose file"}
                </Button>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".csv,text/csv"
                  hidden
                  onChange={(e) => {
                    if (e.target.files?.[0]) loadFile(e.target.files[0]);
                    e.target.value = "";
                  }}
                />
                <p className="muted">
                  CSV files up to {serverPolicy.max_upload_bytes / 1024 / 1024} MB
                </p>
                <p>
                  <em>Need an example? <a className="text-link" href="/samples/01-daily.csv" download="sample-sales.csv">Download a sample</a></em>
                </p>
                <details className="file-requirements">
                  <summary>File requirements</summary>
                  <p className="muted">
                    Up to {num(serverPolicy.max_rows)} sales records and {num(serverPolicy.max_products)} products per file.
                    We analyze one store at a time. Include a date, product, and quantity sold.
                    Keep each product’s sales history together when exporting a smaller file.
                  </p>
                </details>
              </section>
              <section className="intro-panel">
                <h2>A clear path from data to decisions</h2>
                <ol className="journey-list">
                  <li>
                    <strong>Upload your sales</strong>
                    <p>
                      We’ll read your file and ask only if something is unclear.
                    </p>
                  </li>
                  <li>
                    <strong>See future sales</strong>
                    <p>See what’s likely to sell over the next four weeks.</p>
                  </li>
                  <li>
                    <strong>Make a stock plan</strong>
                    <p>
                      Add stock and delivery times, then download your plan.
                    </p>
                  </li>
                </ol>
                <p className="muted">
                  No account needed. Download your results whenever you’re
                  ready.
                </p>
              </section>
            </div>
            <section className="sample-section simple-sample">
              <span>Just looking around?</span>
              <button
                className="text-link"
                disabled={!ready || busy}
                onClick={() => sample("01-daily.csv")}
              >
                Try sample sales
              </button>
              <span className="muted">Example data, no upload needed.</span>
            </section>
            <section className="restore-line">
              <button
                className="text-link"
                onClick={() => backupInput.current?.click()}
              >
                Open saved results
              </button>
              <input
                type="file"
                accept=".json"
                hidden
                ref={backupInput}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f)
                    run(async () => {
                      if (f.size > 25 * 1024 * 1024)
                        throw Error("Backup exceeds 25 MiB.");
                      const s = restore(await f.text());
                      await historySave(s);
                      setHistory(await historyList());
                      openSaved(s);
                    });
                  e.target.value = "";
                }}
              />
            </section>
          </>
        )}
        {phase === "guide" && upload && (
          <GuidedImport
            upload={upload}
            guidance={guidance}
            busy={busy}
            onAnswer={answerGuide}
            onReset={reset}
            onDetails={() => {
              automatic.current = false;
              setPhase("setup");
            }}
          />
        )}
        {phase === "setup" && upload && (
          <Setup
            upload={upload}
            config={config}
            setConfig={setConfig}
            busy={busy}
            onRun={() =>
              run(async () => {
                const { event_labels_text, ...settings } = config;
                if (event_labels_text?.trim()) {
                  settings.event_labels = {};
                  for (const line of event_labels_text
                    .split("\n")
                    .filter((x) => x.trim())) {
                    const parts = line.split("=").map((x) => x.trim());
                    if (
                      parts.length !== 2 ||
                      !parts[0] ||
                      !["sale", "return", "cancellation"].includes(parts[1])
                    )
                      throw Error(
                        "Use one event mapping per line: your label = sale, return, or cancellation.",
                      );
                    settings.event_labels[parts[0].toLowerCase()] = parts[1];
                  }
                }
                const next = await post<{ id: string }>(
                  `/uploads/${upload.id}/review`,
                  settings,
                );
                start(next.id);
              })
            }
          />
        )}
        {phase === "processing" && (
          <section className="processing live-processing">
            <p className="eyebrow">WORKING WITH YOUR DATA</p>
            <h1>
              {job?.kind === "forecast"
                ? "Preparing your forecast."
                : "Checking your sales history."}
            </h1>
            <p>
              We’re checking the file and finding patterns in your sales. Your
              results will appear here automatically.
            </p>
            <div className="processing-state" role="status">
              {job?.state === "completed" ? (
                <Check />
              ) : ["failed", "canceled"].includes(job?.state || "") ? null : (
                <LoaderCircle className="spin" />
              )}
              <strong>
                {job?.state === "queued"
                  ? "Your analysis is next in line…"
                  : job?.kind === "forecast"
                    ? "Testing sales patterns and building your forecast…"
                    : "Checking dates, products and missing sales…"}
              </strong>
              {!!job?.total && (
                <span>
                  {job.done} of {job.total}
                </span>
              )}
            </div>
            {job?.cancel === 1 && job.state === "running" && (
              <p>Stopping your analysis…</p>
            )}
            {job?.error && <Notice tone="warning">{job.error}</Notice>}
            <div className="inline-actions">
              {job && ["queued", "running"].includes(job.state) && (
                <Button
                  variant="secondary"
                  disabled={!!job.cancel}
                  onClick={() =>
                    run(async () => {
                      await post(`/jobs/${job.id}/cancel`);
                      setJob({ ...job, cancel: 1 });
                    })
                  }
                >
                  Cancel processing
                </Button>
              )}
              {job && ["failed", "canceled"].includes(job.state) && (
                <>
                  <Button
                    onClick={() =>
                      run(async () => {
                        const r = await post<{ id: string }>(
                          `/jobs/${job.id}/retry`,
                        );
                        setJobId(null);
                        start(r.id);
                      })
                    }
                  >
                    Retry
                  </Button>
                  {upload && (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setJobId(null);
                        setPhase("setup");
                      }}
                    >
                      Import details
                    </Button>
                  )}
                </>
              )}
            </div>
          </section>
        )}
        {phase === "review" && review && automatic.current && (
          <section className="guided-card">
            {missingQuestion ? (
              <>
                <p className="eyebrow">ONE QUICK QUESTION</p>
                <h1>Did these products have no sales on the missing days?</h1>
                <p>
                  Some days aren’t in the file for{" "}
                  {review.products.filter((p) => p.missing_days > 0).length}{" "}
                  product(s). We won’t treat missing records as zero sales
                  unless you know that’s correct.
                </p>
                <ul className="missing-examples">
                  {review.products
                    .filter((p) => p.missing_days > 0)
                    .slice(0, 5)
                    .map((p) => (
                      <li key={p.product_id}>
                        <strong>{p.name}</strong>: {p.missing_days} missing
                        day(s)
                        {p.missing_date_examples?.length
                          ? `, including ${p.missing_date_examples.join(", ")}`
                          : ""}
                      </li>
                    ))}
                </ul>
                <div className="answer-options">
                  <button
                    className="answer-option"
                    disabled={busy}
                    onClick={() => answerMissing(true)}
                  >
                    <strong>Yes, there were no sales</strong>
                    <span>Count the missing days as zero sales.</span>
                  </button>
                  <button
                    className="answer-option"
                    disabled={busy}
                    onClick={() => answerMissing(false)}
                  >
                    <strong>I’m not sure, or records are missing</strong>
                    <span>
                      Keep those days unknown. Show results only where the
                      history is complete enough.
                    </span>
                  </button>
                </div>
              </>
            ) : review.eligible_products > 0 && !review.global_block ? (
              <>
                <h1>Your data is ready.</h1>
                <p>We couldn’t finish connecting. Your file is still here.</p>
                <Button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const r = await post<{ id: string }>(
                        `/jobs/${reviewId}/forecast`,
                      );
                      start(r.id);
                    })
                  }
                >
                  Try forecast again
                </Button>
              </>
            ) : (
              <>
                <p className="eyebrow">LET’S FIX THIS FIRST</p>
                <h1>
                  {review.products.every((p) => p.days < 56)
                    ? "We need a little more sales history."
                    : "Some sales records need attention."}
                </h1>
                <p>
                  {review.products.every((p) => p.days < 56)
                    ? "Upload at least 8 weeks of daily sales. Around 6 months gives us more history to test the forecast."
                    : "We couldn’t make a reliable forecast from this file yet. The details below show what to fix."}
                </p>
                <Button onClick={reset}>Upload another file</Button>
              </>
            )}
            <details className="quiet-details">
              <summary>See affected products and download issues</summary>
              <QualityView quality={review} />
            </details>
            <button
              className="text-link guided-secondary"
              onClick={() => {
                automatic.current = false;
                setMissingQuestion(false);
                setPhase("setup");
              }}
            >
              Import details
            </button>
          </section>
        )}
        {phase === "review" && review && !automatic.current && (
          <>
            <Steps active={1} />
            <div className="page-heading">
              <p className="eyebrow">YOUR DATA CHECK</p>
              <h1>
                {review.eligible_products
                  ? "Ready for the next step."
                  : "A few things need attention."}
              </h1>
              <p>Review the issues before generating predictions.</p>
            </div>
            <QualityView quality={review} />
            {!!(
              review.comparison?.changed_keys || review.comparison?.removed_keys
            ) && (
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={ackChanges}
                  onChange={(e) => setAckChanges(e.target.checked)}
                />
                I reviewed the changed/removed records and will use this
                replacement analysis. The earlier analysis remains in history.
              </label>
            )}
            {review.eligible_products < review.products.length &&
              review.eligible_products > 0 && (
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={subset}
                    onChange={(e) => setSubset(e.target.checked)}
                  />
                  Continue with the eligible products. Other products will show
                  why their forecasts were withheld.
                </label>
              )}
            <div className="action-row">
              <div className="inline-actions">
                {upload && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setJobId(null);
                      setPhase("setup");
                    }}
                  >
                    Import details
                  </Button>
                )}
                <a
                  className="text-link"
                  href={`/api/jobs/${reviewId}/normalized.csv`}
                >
                  Download normalized data
                </a>
              </div>
              <Button
                disabled={
                  busy ||
                  !review.eligible_products ||
                  review.global_block ||
                  (!!(
                    review.comparison?.changed_keys ||
                    review.comparison?.removed_keys
                  ) &&
                    !ackChanges) ||
                  (review.eligible_products < review.products.length && !subset)
                }
                onClick={() =>
                  run(async () => {
                    const r = await post<{ id: string }>(
                      `/jobs/${reviewId}/forecast`,
                      { acknowledge_changes: ackChanges },
                    );
                    start(r.id);
                  })
                }
              >
                Generate forecasts →
              </Button>
            </div>
          </>
        )}
        {phase === "results" && snapshot && (
          <Results
            key={snapshot.id}
            result={snapshot.result}
            jobId={serverId}
            plans={snapshot.plans}
            requestedTab={requestedTab}
            onExplain={(p) => {
              const assumptions = { ...p.assumptions };
              delete assumptions.timezone;
              setPreviewContext({ ...p, assumptions });
              setQuestion(
                "Explain this un-applied inventory preview and its risks.",
              );
              setDrawer("help");
            }}
            onPlan={(id, p) =>
              run(async () => {
                const settings = { ...p.assumptions };
                delete settings.timezone;
                const saved = await post<Plan>(
                  `/jobs/${serverId}/plans`,
                  settings,
                );
                await persist({
                  ...snapshot,
                  plans: { ...snapshot.plans, [id]: saved },
                });
                setToast(
                  "Scenario revision applied and saved. No purchase order was placed.",
                );
              })
            }
            onBackup={() =>
              download(
                "store.retailplan.json",
                backup(snapshot),
                "application/json",
              )
            }
            onSelected={setSelected}
          />
        )}
        {phase === "summary" && snapshot && (
          <>
            <h1>Saved analysis summary</h1>
            <Notice>
              This analysis exceeded local storage limits. Only totals were
              kept. Re-upload the source or restore a full downloaded workspace
              for daily detail.
            </Notice>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>28-day forecast total</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.result.products.map((p) => (
                    <tr key={p.product_id}>
                      <td>
                        {p.name} · {p.product_id}
                      </td>
                      <td>{num(p.forecast_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
      <footer>
        <span>Retail Planner</span>
        <span>Sales insights. Clearer stock decisions.</span>
      </footer>
      {toast && (
        <div className="toast" role="status">
          {toast}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            ×
          </button>
        </div>
      )}
      <button
        id="assistant-trigger"
        className="ask-fab"
        aria-label="Ask about your data"
        aria-haspopup="dialog"
        onClick={() => setDrawer("help")}
      >
        <MessageSquare size={24} aria-hidden="true" />
        <span>Ask</span>
      </button>
      {drawer && (
        <Drawer
          title={drawer === "help" ? "Ask about your data" : "Your history"}
          onClose={() => setDrawer(null)}
        >
          {drawer === "help" ? (
            <>
              <p>What would you like to understand? Choose a question below or ask your own.</p>
              {phase === "processing" && (
                <Notice>
                  Current step:{" "}
                  {job?.state === "queued"
                    ? "Your analysis is next in line…"
                    : job?.kind === "forecast"
                      ? "Testing sales patterns and building your forecast…"
                      : "Checking dates, products and missing sales…"}
                  .
                </Notice>
              )}
              {!serverPolicy.ai_available ? (
                <Notice>
                  The assistant is unavailable right now. You can still view
                  your forecasts, plan stock and download results.
                </Notice>
              ) : !liveContext ? (
                <Notice>
                  {phase === "processing" ? "I’ll be ready when your results are finished." : phase === "results" || phase === "summary" ? "Upload this sales file again to ask questions about your saved results." : "Upload your sales file first. Once it’s checked, I can help explain your data and results."}
                </Notice>
              ) : (
                <>
                  {previewContext && (
                    <Notice>
                      Discussing this restock estimate:{" "}
                      {num(previewContext.suggested_order_units)} units,
                      arriving {previewContext.arrival_date}.{" "}
                      <button
                        className="text-link"
                        onClick={() => setPreviewContext(null)}
                      >
                        Back to product questions
                      </button>
                    </Notice>
                  )}
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                    />
                    Allow AI help: share my question and this product’s summary with OpenAI.
                  </label>
                  <details className="quiet-details chat-privacy"><summary>What is shared?</summary><p>Your raw CSV rows and customer columns are not sent. Recent messages are stored for up to 7 days. AI can make mistakes; check the linked results.</p></details>
                  <p className="chat-context">Talking about <strong>{snapshot?.result.products.find(p => p.product_id === activePid)?.name || review?.products.find(p => p.product_id === activePid)?.name || activePid || "your sales"}</strong></p>
                  {conversation.length === 0 && <div className="button-stack">
                    {([...warningQuestions, ...(previewContext ? ["Explain this restock amount simply.", "Could I run out before delivery?"] : phase === "review" ? ["What needs fixing in my data?", "What should I upload next?"] : ["Explain this product’s forecast simply.", "Can I trust this estimate?", "What should I do next?"])]).slice(0, 3).map((q) => (
                      <Button
                        key={q}
                        variant="secondary"
                        disabled={!consent || asking}
                        onClick={() => ask(q)}
                      >
                        {q}
                      </Button>
                    ))}
                  </div>}
                  {conversation.map((m, i) => (
                    <section className="answer" key={m.created + ":" + i}>
                      <p className="chat-question">{m.question}</p>
                      <p>{m.answer}</p>
                      <div className="inline-actions">
                        {uniqueEvidenceLinks(m.citations).map((c) => (
                          <button
                            key={c}
                            className="text-link"
                            onClick={() => evidenceLink(c, m.question)}
                          >
                            {c === "quality" ? "See data check" : c === "inventory" || c === "scenario" ? "See stock plan" : c === "rows" ? "See sales records" : "See forecast"}
                          </button>
                        ))}
                      </div>
                    </section>
                  ))}
                  {answer && (
                    <div className="answer" role="status">
                      <p>{answer}</p>
                      {citations.length > 0 && (
                        <p className="muted">
                          {uniqueEvidenceLinks(citations).map((c) => (
                            <button
                              key={c}
                              className="text-link"
                              onClick={() => evidenceLink(c)}
                            >
                              {c === "quality" ? "See data check" : c === "inventory" || c === "scenario" ? "See stock plan" : c === "rows" ? "See sales records" : "See forecast"}{" "}
                            </button>
                          ))}
                        </p>
                      )}
                    </div>
                  )}
                  {conversation.length > 0 && !asking && !answer && (
                    <div className="chat-followups" aria-label="Suggested follow-up questions">
                      <small>You could also ask</small>
                      <div>
                        {([...warningQuestions, ...(previewContext
                          ? ["Could I run out before delivery?", "Explain this restock amount simply.", "What assumptions does this plan use?", "What should I check before ordering?"]
                          : ["What should I do next?", "Can I trust this estimate?", "What could change these sales?", "What data would improve this forecast?", "Explain this product’s forecast simply.", "What should I check before restocking?"]) ]
                        ).filter(q => !conversation.some(m => m.question.toLowerCase().trim() === q.toLowerCase().trim())).slice(0, 3).map(q => (
                          <button type="button" key={q} disabled={!consent} onClick={() => ask(q)}>{q}</button>
                        ))}
                      </div>
                    </div>
                  )}
                  {asking && <p role="status" className="chat-thinking">Looking at your data…</p>}
                  <div ref={chatEnd} />
                  <form className="ask-composer"
                    onSubmit={(e) => {
                      e.preventDefault();
                      ask(question);
                    }}
                  >
                    <label className="field">
                      Ask a question
                      <textarea
                        maxLength={1500}
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        rows={2}
                        placeholder="e.g. How much stock will I need?"
                      />
                    </label>
                    <Button disabled={!consent || asking || !question.trim()}>
                      {asking ? "Thinking…" : "Send"}
                    </Button>
                  </form>
                </>
              )}
            </>
          ) : (
            <>
              <p>Pick a file to revisit your results.</p>
              <details className="quiet-details"><summary>How history is saved</summary><p>Your last 10 results stay in this browser. Download a copy to keep them on another device or after clearing browser data.</p></details>
              {!history.length && <p>No saved results yet.</p>}
              {history.map((s) => (
                <section className="history-item" key={s.id}>
                  <strong>{s.name}</strong>
                  <p>
                    {s.result.products.length} products · Forecast from {friendlyDate(s.result.forecast_start)}
                  </p>
                  <div className="inline-actions">
                    <Button variant="secondary" onClick={() => openSaved(s)}>
                      Open
                    </Button>
                    <details className="history-options"><summary>More options</summary>
                    <Button
                      variant="text"
                      onClick={() =>
                        download(
                          "store.retailplan.json",
                          backup(s),
                          "application/json",
                        )
                      }
                    >
                      Download
                    </Button>
                    <Button
                      variant="text"
                      onClick={() =>
                        run(async () => {
                          await historyDelete(s.id);
                          setHistory(await historyList());
                          setToast(
                            "Removed from this browser’s history. Your uploaded file has not been deleted.",
                          );
                        })
                      }
                    >
                      Remove from history
                    </Button>
                    </details>
                  </div>
                </section>
              ))}
              <details className="quiet-details">
              <summary>Recent uploads</summary>
              <p className="muted">Reopen an upload to continue using AI. Uploads and chats are temporary and may disappear within 7 days. Downloaded copies and browser history are kept separately.</p>
              {!jobs.length && <p>No recent uploads available.</p>}
              {jobs.map((j) => (
                <section className="history-item" key={j.id}>
                  <strong>
                    {j.kind === "forecast" ? "Forecast" : "Data check"} ·{" "}
                    {j.state}
                  </strong>
                  <p>{new Date(j.created * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</p>
                  <div className="inline-actions">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setDrawer(null);
                        start(j.id);
                      }}
                    >
                      Open
                    </Button>
                    <Button
                      variant="text"
                      onClick={() =>
                        run(async () => {
                          await api(`/uploads/${j.upload}`, {
                            method: "DELETE",
                          });
                          setJobs(jobs.filter((x) => x.upload !== j.upload));
                          if (job?.upload === j.upload) {
                            reset();
                          }
                          setToast(
                            "Source file and associated server analyses deleted. Downloaded and local copies remain.",
                          );
                        })
                      }
                    >
                      Delete uploaded file
                    </Button>
                  </div>
                </section>
              ))}
              </details>
            </>
          )}
        </Drawer>
      )}
    </div>
  );
}
function Drawer({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const trigger = document.getElementById(
      title === "Ask about your data" ? "assistant-trigger" : "history-trigger",
    );
    dialog?.showModal();
    return () => {
      dialog?.close();
      queueMicrotask(() => trigger?.focus());
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="live-drawer"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close panel"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <div className="drawer-content">{children}</div>
    </dialog>
  );
}
