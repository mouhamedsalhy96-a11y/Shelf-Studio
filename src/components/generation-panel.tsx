"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  CheckCheck,
  FileText,
  LoaderCircle,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { getSupabase } from "@/lib/supabase/browser";
import {
  mergeGenerationHistory,
  type GenerationHistoryEntry,
  type GenerationHistoryPage,
} from "@/lib/generation-history";

type GeneratedJob = {
  id: string;
  requestKey: string;
  projectId: string;
  status: "creating" | "processing" | "succeeded" | "failed";
  description: string;
  caption: string;
  warnings: string[];
  imageUrl: string | null;
  originalUrl: string | null;
  error: string | null;
  productName: string;
  scene: string;
  ratio: string;
  createdAt: string;
};
type Result = {
  job: GeneratedJob | null;
  remaining: number | null;
  enabled: boolean;
};
class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
async function authorizedFetch(url: string, init?: RequestInit) {
  const { data, error } = await getSupabase().auth.getSession();
  if (error || !data.session) throw new ApiError("Please sign in again.", 401);
  return fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
      Authorization: `Bearer ${data.session.access_token}`,
    },
    signal: AbortSignal.timeout(60000),
  });
}
async function api<T = Result>(url: string, init?: RequestInit): Promise<T> {
  const response = await authorizedFetch(url, init);
  const result = await response.json();
  if (!response.ok)
    throw new ApiError(
      result.error || "The request could not be completed.",
      response.status,
    );
  return result;
}
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function GenerationPanel({
  userId,
  projectId,
  dirty,
  workspaceBusy,
}: {
  userId: string | undefined;
  projectId: string | null;
  dirty: boolean;
  workspaceBusy: boolean;
}) {
  const [job, setJob] = useState<GeneratedJob | null>(null);
  const [history, setHistory] = useState<GenerationHistoryEntry[]>([]);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(
    Boolean(userId && projectId),
  );
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const historyOperation = useRef(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(Boolean(userId && projectId));
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [description, setDescription] = useState("");
  const [caption, setCaption] = useState("");
  const [view, setView] = useState<"original" | "generated">("generated");
  const [imageFailed, setImageFailed] = useState(false);
  const requestKey = useRef<string | null>(null);
  const operation = useRef(false);
  const active = useRef(true);
  const pending = job?.status === "creating" || job?.status === "processing";
  const copyReady = Boolean(job?.description && job?.caption);
  const copyChanged =
    copyReady && (description !== job?.description || caption !== job?.caption);
  function apply(result: Result) {
    if (result.job) {
      const saved = result.job;
      setHistory((current) =>
        mergeGenerationHistory(current, [
          {
            id: saved.id,
            status: saved.status,
            createdAt: saved.createdAt,
            productName: saved.productName,
            scene: saved.scene,
            ratio: saved.ratio,
            hasCopy: Boolean(saved.description && saved.caption),
            imageUrl: saved.imageUrl,
          },
        ]),
      );
    }
    setJob(result.job);
    setRemaining(result.remaining);
    setEnabled(result.enabled);
    setImageFailed(false);
    setDescription(result.job?.description || "");
    setCaption(result.job?.caption || "");
  }
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    let current = true;
    if (userId && projectId) {
      historyOperation.current = true;
      api<GenerationHistoryPage>(
        `/api/generations/history?projectId=${encodeURIComponent(projectId)}`,
      )
        .then((page) => {
          if (current) {
            setHistory((existing) =>
              mergeGenerationHistory(existing, page.items),
            );
            setHistoryCursor(page.nextCursor);
            setHistoryLoaded(true);
          }
        })
        .catch((cause) => {
          if (current)
            setHistoryError(
              cause instanceof Error
                ? cause.message
                : "Your saved versions could not be loaded.",
            );
        })
        .finally(() => {
          historyOperation.current = false;
          if (current) setHistoryLoading(false);
        });
      api(`/api/generations?projectId=${encodeURIComponent(projectId)}`)
        .then((result) => {
          if (current) apply(result);
        })
        .catch((cause) => {
          if (current)
            setError(
              cause instanceof Error
                ? cause.message
                : "Saved generations could not be loaded.",
            );
        })
        .finally(() => {
          if (current) setLoading(false);
        });
    }
    return () => {
      current = false;
    };
  }, [userId, projectId]);
  useEffect(() => {
    if (!job || !pending) return;
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    const id = job.id;
    async function poll() {
      try {
        const result = await api(
          `/api/generations?id=${encodeURIComponent(id)}`,
        );
        if (!current) return;
        apply(result);
        setError("");
        if (
          result.job &&
          ["creating", "processing"].includes(result.job.status)
        )
          timer = setTimeout(() => void poll(), 4000);
      } catch (cause) {
        if (current)
          setError(
            cause instanceof Error
              ? cause.message
              : "Status checking paused. Use Check status to continue.",
          );
      }
    }
    timer = setTimeout(() => void poll(), 4000);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [job, pending]);
  async function start() {
    if (
      operation.current ||
      !projectId ||
      !userId ||
      dirty ||
      workspaceBusy ||
      !enabled ||
      pending ||
      loading ||
      uncertain ||
      copyChanged
    )
      return;
    operation.current = true;
    setWorking(true);
    setError("");
    setNotice("");
    requestKey.current ||= crypto.randomUUID();
    try {
      const result = await api("/api/generations", {
        method: "POST",
        body: JSON.stringify({ projectId, requestKey: requestKey.current }),
      });
      if (!active.current) return;
      apply(result);
      requestKey.current = null;
      setUncertain(false);
      setView("generated");
    } catch (cause) {
      if (!active.current) return;
      const unknown = !(cause instanceof ApiError) || cause.status >= 500;
      setUncertain(unknown);
      if (!unknown) requestKey.current = null;
      setError(
        cause instanceof Error
          ? cause.message
          : "We couldn’t confirm the attempt. Check status before retrying.",
      );
    } finally {
      operation.current = false;
      if (active.current) setWorking(false);
    }
  }
  async function checkStatus() {
    if (operation.current || !projectId || copyChanged) return;
    operation.current = true;
    setWorking(true);
    setError("");
    try {
      const query =
        job && !uncertain
          ? `id=${encodeURIComponent(job.id)}`
          : `projectId=${encodeURIComponent(projectId)}`;
      const result = await api(`/api/generations?${query}`);
      if (!active.current) return;
      apply(result);
      setUncertain(false);
      if (result.job && result.job.requestKey === requestKey.current)
        requestKey.current = null;
    } catch (cause) {
      if (active.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "Status is unavailable. Try again.",
        );
    } finally {
      operation.current = false;
      if (active.current) setWorking(false);
    }
  }
  async function loadHistory(append = false) {
    if (!projectId || historyOperation.current) return;
    historyOperation.current = true;
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const cursor =
        append && historyCursor
          ? `&cursor=${encodeURIComponent(historyCursor)}`
          : "";
      const page = await api<GenerationHistoryPage>(
        `/api/generations/history?projectId=${encodeURIComponent(projectId)}${cursor}`,
      );
      if (!active.current) return;
      setHistory((existing) => mergeGenerationHistory(existing, page.items));
      if (append || !historyLoaded) setHistoryCursor(page.nextCursor);
      setHistoryLoaded(true);
    } catch (cause) {
      if (active.current)
        setHistoryError(
          cause instanceof Error
            ? cause.message
            : "Your saved versions could not be loaded.",
        );
    } finally {
      historyOperation.current = false;
      if (active.current) setHistoryLoading(false);
    }
  }
  async function openVersion(id: string) {
    if (
      id === job?.id ||
      operation.current ||
      pending ||
      copyChanged ||
      workspaceBusy
    )
      return;
    operation.current = true;
    setWorking(true);
    setError("");
    setNotice("");
    try {
      const result = await api(`/api/generations?id=${encodeURIComponent(id)}`);
      if (!active.current) return;
      apply(result);
      setView("generated");
      setNotice("Saved version opened. Browsing uses no generation credits.");
    } catch (cause) {
      if (active.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "This version could not be opened.",
        );
    } finally {
      operation.current = false;
      if (active.current) setWorking(false);
    }
  }
  async function saveCopy() {
    if (!job || operation.current || pending) return;
    operation.current = true;
    setWorking(true);
    setError("");
    setNotice("");
    try {
      const result = await api("/api/generations", {
        method: "PATCH",
        body: JSON.stringify({ id: job.id, description, caption }),
      });
      if (active.current) {
        apply(result);
        setNotice("Your copy edits have been saved to this generation.");
      }
    } catch (cause) {
      if (active.current)
        setError(
          cause instanceof Error ? cause.message : "Copy could not be saved.",
        );
    } finally {
      operation.current = false;
      if (active.current) setWorking(false);
    }
  }
  async function downloadImage() {
    if (!job || operation.current) return;
    operation.current = true;
    setWorking(true);
    setError("");
    try {
      const response = await authorizedFetch(
        `/api/generations/image?id=${encodeURIComponent(job.id)}`,
      );
      if (!response.ok)
        throw new Error(
          (await response.json()).error || "The image could not be downloaded.",
        );
      const blob = await response.blob();
      if (active.current) downloadBlob(blob, "shelf-studio-generated.png");
    } catch (cause) {
      if (active.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "The image could not be downloaded.",
        );
    } finally {
      operation.current = false;
      if (active.current) setWorking(false);
    }
  }
  return (
    <section className="ai-workspace" aria-label="AI product assets">
      <div className="generation-bar">
        <div className="generation-note">
          <Sparkles size={18} />
          <div>
            <strong>One brief. A whole new look.</strong>
            <span>
              {pending
                ? "Preparing your saved product’s assets…"
                : "One image, a product description and a social caption."}
            </span>
          </div>
        </div>
        <button
          className="button generate-button"
          onClick={() => void start()}
          disabled={
            !userId ||
            !projectId ||
            dirty ||
            workspaceBusy ||
            working ||
            loading ||
            pending ||
            !enabled ||
            uncertain ||
            remaining === 0 ||
            copyChanged
          }
        >
          {working || pending ? (
            <LoaderCircle size={15} className="spin" />
          ) : (
            <Sparkles size={15} />
          )}
          {working
            ? "Please wait…"
            : pending
              ? "Generating…"
              : job
                ? "Generate another set"
                : "Generate assets"}
          <ArrowRight size={15} />
        </button>
      </div>
      <div className="generation-info">
        {!userId ? (
          <p>
            <Link href="/account">Sign in</Link> to generate assets.
          </p>
        ) : !projectId || dirty ? (
          <p>
            Save your current photo and product details to your account before
            generating.
          </p>
        ) : loading ? (
          <p role="status">Checking saved generations…</p>
        ) : !enabled ? (
          <p>Generation is temporarily unavailable.</p>
        ) : (
          <p>
            {remaining === null
              ? "Up to 3 attempts per account per day."
              : `${remaining} of 3 attempts left today.`}{" "}
            Limits reset at midnight UTC. Failed attempts count too.
          </p>
        )}
        <p>
          Generation uses API credits. Product details go to OpenAI; the product
          photo goes to Replicate.
        </p>
        {projectId && userId && (
          <button
            className="refresh-generation"
            disabled={working || loading || copyChanged}
            onClick={() => void checkStatus()}
          >
            <RefreshCw size={12} />
            {pending || uncertain ? "Check status" : "Refresh saved result"}
          </button>
        )}
      </div>
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      {job?.error && (
        <p className="notice notice-warning" role="status">
          {job.error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {userId && projectId && (
        <section
          className="generation-history"
          aria-label="Saved generation versions"
        >
          <div className="history-heading">
            <div>
              <h2>Saved versions.</h2>
              <p>
                Revisit earlier assets. Browsing uses no generation credits.
              </p>
            </div>
            <button
              className="refresh-generation"
              disabled={historyLoading || working}
              onClick={() => void loadHistory()}
            >
              <RefreshCw size={12} />
              Refresh history
            </button>
          </div>
          {copyChanged && (
            <div className="history-edit-notice" role="status">
              <p>
                You have unsaved copy edits. Save them before switching versions
                or generating another set.
              </p>
              <button
                onClick={() => {
                  setDescription(job?.description || "");
                  setCaption(job?.caption || "");
                  setNotice("Unsaved copy edits discarded.");
                }}
              >
                Discard copy edits
              </button>
            </div>
          )}
          {pending && (
            <p className="history-hint">
              Your current attempt is still running. You can open another
              version when it finishes.
            </p>
          )}
          {historyError && (
            <p className="notice notice-error" role="alert">
              {historyError}
            </p>
          )}
          {history.length ? (
            <ul className="history-grid">
              {history.map((entry, index) => (
                <li key={entry.id}>
                  <button
                    className={
                      "history-card " + (entry.id === job?.id ? "selected" : "")
                    }
                    aria-pressed={entry.id === job?.id}
                    disabled={
                      working || pending || copyChanged || workspaceBusy
                    }
                    onClick={() => void openVersion(entry.id)}
                  >
                    <span className="history-thumbnail">
                      {entry.imageUrl ? (
                        <Image
                          src={entry.imageUrl}
                          alt=""
                          fill
                          unoptimized
                          loading="lazy"
                          sizes="64px"
                        />
                      ) : (
                        <Sparkles size={20} />
                      )}
                    </span>
                    <span className="history-card-content">
                      <span className="history-card-top">
                        <time dateTime={entry.createdAt}>
                          {new Date(entry.createdAt).toLocaleString("en-GB", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </time>
                        {index === 0 && (
                          <span className="history-latest">Latest</span>
                        )}
                      </span>
                      <strong>{entry.productName}</strong>
                      <span>
                        {entry.scene === "studio"
                          ? "Clean studio"
                          : entry.scene === "lifestyle"
                            ? "Everyday living"
                            : "Seasonal mood"}{" "}
                        · {entry.ratio}
                      </span>
                      <span className={"history-status status-" + entry.status}>
                        {entry.status === "succeeded"
                          ? "Ready"
                          : entry.status === "failed"
                            ? entry.hasCopy
                              ? "Copy available · Image incomplete"
                              : "Didn’t finish"
                            : "In progress"}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : !historyLoading && !historyError ? (
            <p className="history-hint">
              Your saved generations will appear here after your first attempt.
            </p>
          ) : null}
          {historyLoading && (
            <p className="history-hint" role="status">
              Loading saved versions…
            </p>
          )}
          {historyCursor && (
            <button
              className="button secondary history-load-more"
              disabled={historyLoading || working}
              onClick={() => void loadHistory(true)}
            >
              Load earlier versions
            </button>
          )}
        </section>
      )}
      {job && (
        <p className="generation-version">
          Saved version: {job.productName} · {job.scene} · {job.ratio}.{" "}
          {dirty
            ? "Current workspace changes are not part of this result."
            : "AI output — review before use."}
        </p>
      )}
      {job?.status === "succeeded" && (
        <section
          className="generated-result"
          aria-label="Generated product image"
        >
          <div className="generated-heading">
            <h2>A new setting.</h2>
            <div>
              {job.originalUrl && (
                <button
                  aria-pressed={view === "original"}
                  onClick={() => setView("original")}
                >
                  Original
                </button>
              )}
              <button
                aria-pressed={view === "generated"}
                onClick={() => setView("generated")}
              >
                AI generated
              </button>
            </div>
          </div>
          <div
            className="generated-image"
            style={{ aspectRatio: job.ratio.replace(":", " / ") }}
          >
            {view === "original" && job.originalUrl && !imageFailed ? (
              <Image
                src={job.originalUrl!}
                alt="Original product photo used for this generation"
                onError={() => setImageFailed(true)}
                fill
                unoptimized
                sizes="(max-width: 800px) 90vw, 55vw"
              />
            ) : job.imageUrl && !imageFailed ? (
              <Image
                key={job.imageUrl}
                src={job.imageUrl}
                alt={`AI generated setting for ${job.productName}; verify product details`}
                fill
                unoptimized
                sizes="(max-width: 800px) 90vw, 55vw"
                onError={() => setImageFailed(true)}
              />
            ) : (
              <p>
                Your generated image is saved. Refresh the saved result to renew
                its preview.
              </p>
            )}
          </div>
          <button
            className="button secondary"
            disabled={working}
            onClick={() => void downloadImage()}
          >
            <ArrowDownToLine size={14} />
            Download generated image
          </button>
        </section>
      )}
      <section className="content-output">
        <div className="content-output-heading">
          <h2>Words to go with it.</h2>
          <span>
            {pending
              ? "Generating"
              : copyReady
                ? "AI draft · Editable"
                : "Awaiting generation"}
          </span>
        </div>
        {copyReady ? (
          <>
            <div className="generated-copy-grid">
              <div>
                <label htmlFor="generated-description">
                  <FileText size={14} />
                  Product description
                </label>
                <textarea
                  id="generated-description"
                  value={description}
                  maxLength={1600}
                  rows={7}
                  disabled={working || pending}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </div>
              <div>
                <label htmlFor="generated-caption">
                  <Sparkles size={14} />
                  Social caption
                </label>
                <textarea
                  id="generated-caption"
                  value={caption}
                  maxLength={500}
                  rows={7}
                  disabled={working || pending}
                  onChange={(event) => setCaption(event.target.value)}
                />
              </div>
            </div>
            <div className="copy-actions">
              <button
                className="button secondary"
                onClick={() => void saveCopy()}
                disabled={
                  working ||
                  pending ||
                  !description.trim() ||
                  !caption.trim() ||
                  (description === job?.description && caption === job?.caption)
                }
              >
                Save copy edits
              </button>
              <button
                className="button secondary"
                onClick={() =>
                  downloadBlob(
                    new Blob([`${description}\n\n${caption}`], {
                      type: "text/plain;charset=utf-8",
                    }),
                    "shelf-studio-copy.txt",
                  )
                }
                disabled={pending}
              >
                Download copy
              </button>
            </div>
            {job?.warnings?.length ? (
              <ul className="copy-warnings">
                {job.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <div className="copy-grid">
            <div>
              <span>
                <FileText size={14} />
                Product description
              </span>
              <div className="skeleton-line long" />
              <div className="skeleton-line" />
              <div className="skeleton-line short" />
              <p>Copy will use only the product facts you supply.</p>
            </div>
            <div>
              <span>
                <Sparkles size={14} />
                Social caption
              </span>
              <div className="skeleton-line long" />
              <div className="skeleton-line short" />
              <p>A caption for your next product image.</p>
            </div>
          </div>
        )}
      </section>
      <div className="review-note">
        <CheckCheck size={14} />
        <span>
          Review labels, colours and product claims before publishing. AI can
          change details or make mistakes.
        </span>
      </div>
    </section>
  );
}
