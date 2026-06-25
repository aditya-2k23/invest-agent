"use client";

import { useState, useRef } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StepStatus = "idle" | "running" | "done" | "error";

interface StepState {
  status: StepStatus;
  data?: unknown;
}

interface PipelineState {
  lookup: StepState;
  financials: StepState;
  news: StepState;
  competitive: StepState;
  synthesis: StepState;
}

type PipelineKey = keyof PipelineState;

// NDJSON chunk shapes that can arrive from the API route
interface StreamChunk {
  step: string;
  status: string;
  company?: string;
  data?: unknown;
  message?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PIPELINE_STEPS: { key: PipelineKey; label: string }[] = [
  { key: "lookup", label: "Company Lookup" },
  { key: "financials", label: "Financials" },
  { key: "news", label: "News" },
  { key: "competitive", label: "Competitive Analysis" },
  { key: "synthesis", label: "Synthesis" },
];

const INITIAL_PIPELINE: PipelineState = {
  lookup: { status: "idle" },
  financials: { status: "idle" },
  news: { status: "idle" },
  competitive: { status: "idle" },
  synthesis: { status: "idle" },
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusDot({ status }: { status: StepStatus }) {
  if (status === "idle") {
    return <span className="inline-block h-2.5 w-2.5 rounded-full bg-zinc-300" />;
  }
  if (status === "running") {
    return (
      <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-400 animate-pulse" />
    );
  }
  if (status === "done") {
    return <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />;
  }
  // error
  return <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" />;
}

function StepCard({ label, state }: { label: string; state: StepState }) {
  const borderColor =
    state.status === "running"
      ? "border-amber-400"
      : state.status === "done"
        ? "border-emerald-500"
        : state.status === "error"
          ? "border-red-500"
          : "border-zinc-200";

  const statusText =
    state.status === "idle"
      ? "Waiting"
      : state.status === "running"
        ? "Running…"
        : state.status === "done"
          ? "Done"
          : "Error";

  return (
    <div
      className={`flex items-center justify-between rounded-lg border ${borderColor} bg-white px-4 py-3 shadow-sm transition-colors duration-300`}
    >
      <div className="flex items-center gap-3">
        <StatusDot status={state.status} />
        <span className="text-sm font-medium text-zinc-800">{label}</span>
      </div>
      <span
        className={`text-xs font-medium ${
          state.status === "running"
            ? "text-amber-500"
            : state.status === "done"
              ? "text-emerald-600"
              : state.status === "error"
                ? "text-red-600"
                : "text-zinc-400"
        }`}
      >
        {statusText}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export default function Home() {
  const [company, setCompany] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [pipeline, setPipeline] = useState<PipelineState>(INITIAL_PIPELINE);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDone, setIsDone] = useState(false);

  // Keep a ref to allow potential abort in the future without re-rendering.
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);

  // Convenience updater — merges a partial StepState into one pipeline key.
  function updateStep(key: PipelineKey, patch: Partial<StepState>) {
    setPipeline((prev) => ({
      ...prev,
      [key]: { ...prev[key], ...patch },
    }));
  }

  // Apply a parsed NDJSON chunk to the component state.
  function applyChunk(chunk: StreamChunk) {
    const step = chunk.step as PipelineKey | "start" | "done" | "error";

    if (step === "start" || step === "done") {
      if (step === "done") setIsDone(true);
      return;
    }

    if (step === "error") {
      setErrorMessage(chunk.message ?? "An unknown error occurred.");
      setIsRunning(false);
      return;
    }

    // Guard: only update known pipeline keys.
    if (!(step in INITIAL_PIPELINE)) return;

    const key = step as PipelineKey;
    if (chunk.status === "running") {
      updateStep(key, { status: "running" });
    } else if (chunk.status === "done") {
      updateStep(key, { status: "done", data: chunk.data });
    }
  }

  async function startResearch() {
    if (!company.trim() || isRunning) return;

    // Reset all state for a fresh run.
    setPipeline(INITIAL_PIPELINE);
    setErrorMessage(null);
    setIsDone(false);
    setHasStarted(true);
    setIsRunning(true);

    let response: Response;
    try {
      response = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company: company.trim() }),
      });
    } catch (err) {
      setErrorMessage(
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
      );
      setIsRunning(false);
      return;
    }

    if (!response.body) {
      setErrorMessage("Server returned no response body.");
      setIsRunning(false);
      return;
    }

    const reader = response.body.getReader();
    readerRef.current = reader;
    const decoder = new TextDecoder();

    // Buffer holds any incomplete line carried over from the previous chunk.
    // This handles the case where a JSON object is split across two network packets.
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Append decoded bytes to the carry-over buffer.
        buffer += decoder.decode(value, { stream: true });

        // Split on newlines. The last element may be an incomplete line —
        // keep it in the buffer for the next iteration.
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const chunk = JSON.parse(trimmed) as StreamChunk;
            applyChunk(chunk);
          } catch {
            // Skip malformed lines rather than crashing the whole stream.
          }
        }
      }

      // Process any remaining bytes after the stream closes.
      if (buffer.trim()) {
        try {
          applyChunk(JSON.parse(buffer) as StreamChunk);
        } catch {
          // Ignore trailing garbage.
        }
      }
    } catch (err) {
      setErrorMessage(
        `Stream read error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setIsRunning(false);
    }
  }

  const synthesisData = pipeline.synthesis.data;
  const synthesisVerdict =
    synthesisData !== null &&
    typeof synthesisData === "object" &&
    "verdict" in (synthesisData as Record<string, unknown>)
      ? (synthesisData as Record<string, unknown>).verdict
      : null;

  return (
    <div className="min-h-screen bg-zinc-50 font-sans">
      {/* Header */}
      <header className="border-b border-zinc-200 bg-white px-6 py-4">
        <div className="mx-auto max-w-2xl">
          <h1 className="text-lg font-semibold text-zinc-900">
            AI Investment Research Agent
          </h1>
          <p className="text-sm text-zinc-500">
            Enter a company name to run a full research pipeline.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-10 space-y-8">
        {/* ---- Search section ---- */}
        <section aria-label="Company search">
          <div className="flex gap-3">
            <input
              id="company-input"
              type="text"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void startResearch();
              }}
              placeholder="e.g. Apple, Reliance Industries, TSMC"
              disabled={isRunning}
              className="flex-1 rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
            />
            <button
              id="research-button"
              onClick={() => void startResearch()}
              disabled={isRunning || !company.trim()}
              className="rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
            >
              {isRunning ? "Running…" : "Research"}
            </button>
          </div>
        </section>

        {/* ---- Pipeline progress section ---- */}
        {hasStarted && (
          <section aria-label="Pipeline progress">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-400">
              Pipeline
            </h2>
            <div className="space-y-2">
              {PIPELINE_STEPS.map(({ key, label }) => (
                <StepCard key={key} label={label} state={pipeline[key]} />
              ))}
            </div>
          </section>
        )}

        {/* ---- Error message ---- */}
        {errorMessage && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            <span className="font-medium">Error: </span>
            {errorMessage}
          </div>
        )}

        {/* ---- Results section — shown once synthesis step completes ---- */}
        {isDone && pipeline.synthesis.status === "done" && (
          <section aria-label="Research results">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-400">
              Result
            </h2>

            {/* Verdict badge */}
            {typeof synthesisVerdict === "string" && (
              <div className="mb-4">
                <span
                  className={`inline-flex items-center rounded-full px-5 py-1.5 text-base font-bold tracking-wide ${
                    synthesisVerdict === "INVEST"
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-red-100 text-red-700"
                  }`}
                >
                  {synthesisVerdict}
                </span>
              </div>
            )}

            {/* Raw synthesis data — placeholder until the LLM synthesis node is built */}
            <div className="rounded-lg border border-zinc-200 bg-white">
              <div className="border-b border-zinc-100 px-4 py-2">
                <span className="text-xs font-medium text-zinc-400">
                  Synthesis data (stub)
                </span>
              </div>
              <pre className="overflow-x-auto p-4 text-xs leading-relaxed text-zinc-700">
                {JSON.stringify(pipeline.synthesis.data, null, 2)}
              </pre>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
