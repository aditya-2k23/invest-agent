"use client";

import { useState, useRef } from "react";

// Types
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

interface StreamChunk {
  step: string;
  status: string;
  company?: string;
  data?: unknown;
  message?: string;
}

// Constants
const PIPELINE_STEPS: { key: PipelineKey; label: string; icon: string }[] = [
  { key: "lookup", label: "Company Lookup", icon: "🔍" },
  { key: "financials", label: "Financials", icon: "📊" },
  { key: "news", label: "News & Sentiment", icon: "📰" },
  { key: "competitive", label: "Competitive Analysis", icon: "⚔️" },
  { key: "synthesis", label: "AI Synthesis", icon: "✦" },
];

const INITIAL_PIPELINE: PipelineState = {
  lookup: { status: "idle" },
  financials: { status: "idle" },
  news: { status: "idle" },
  competitive: { status: "idle" },
  synthesis: { status: "idle" },
};

// Sub-components
function StepCard({
  label,
  icon,
  state,
  index,
}: {
  label: string;
  icon: string;
  state: StepState;
  index: number;
}) {
  const isIdle = state.status === "idle";
  const isRunning = state.status === "running";
  const isDone = state.status === "done";

  return (
    <div
      className={`relative flex items-center gap-4 rounded-xl border px-5 py-4 transition-all duration-500 ${
        isRunning
          ? "border-amber-500/40 bg-amber-500/5 shadow-lg shadow-amber-500/10"
          : isDone
            ? "border-emerald-500/30 bg-emerald-500/5"
            : isIdle
              ? "border-white/5 bg-white/3"
              : "border-red-500/30 bg-red-500/5"
      }`}
    >
      {/* Step number badge */}
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold transition-colors duration-500 ${
          isRunning
            ? "bg-amber-500 text-black"
            : isDone
              ? "bg-emerald-500 text-black"
              : "bg-white/8 text-white/30"
        }`}
      >
        {isDone ? "✓" : index + 1}
      </div>

      {/* Label + icon */}
      <div className="flex flex-1 items-center gap-2">
        <span className="text-base">{icon}</span>
        <span
          className={`text-sm font-medium transition-colors duration-300 ${
            isRunning
              ? "text-white"
              : isDone
                ? "text-white/90"
                : "text-white/35"
          }`}
        >
          {label}
        </span>
      </div>

      {/* Status badge */}
      <div className="flex items-center gap-2">
        {isRunning && (
          <span className="flex gap-0.5">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="inline-block h-1 w-1 rounded-full bg-amber-400 animate-bounce"
                style={{ animationDelay: `${i * 150}ms` }}
              />
            ))}
          </span>
        )}
        <span
          className={`text-xs font-semibold tracking-wide ${
            isRunning
              ? "text-amber-400"
              : isDone
                ? "text-emerald-400"
                : "text-white/20"
          }`}
        >
          {isIdle
            ? "WAITING"
            : isRunning
              ? "RUNNING"
              : isDone
                ? "DONE"
                : "ERROR"}
        </span>
      </div>
    </div>
  );
}

export default function Home() {
  const [company, setCompany] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [pipeline, setPipeline] = useState<PipelineState>(INITIAL_PIPELINE);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDone, setIsDone] = useState(false);

  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(
    null,
  );

  function updateStep(key: PipelineKey, patch: Partial<StepState>) {
    setPipeline((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  function applyChunk(chunk: StreamChunk) {
    const step = chunk.step as PipelineKey | "start" | "done" | "error";

    if (step === "done") {
      setIsDone(true);
      return;
    }
    if (step === "start") return;

    if (step === "error") {
      setErrorMessage(chunk.message ?? "An unknown error occurred.");
      setIsRunning(false);
      return;
    }

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
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Split on newlines; keep any incomplete trailing line in the buffer
        // to handle NDJSON objects that are split across network packets.
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            applyChunk(JSON.parse(trimmed) as StreamChunk);
          } catch {
            /* skip malformed */
          }
        }
      }

      if (buffer.trim()) {
        try {
          applyChunk(JSON.parse(buffer) as StreamChunk);
        } catch {
          /* ignore trailing */
        }
      }
    } catch (err) {
      setErrorMessage(
        `Stream error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setIsRunning(false);
    }
  }

  // Derived state for results panel
  const synthesisData = pipeline.synthesis.data;
  const synthesisVerdict =
    synthesisData !== null &&
    typeof synthesisData === "object" &&
    "verdict" in (synthesisData as Record<string, unknown>)
      ? String((synthesisData as Record<string, unknown>).verdict)
      : null;

  const doneCount = PIPELINE_STEPS.filter(
    (s) => pipeline[s.key].status === "done",
  ).length;
  const progress = hasStarted
    ? Math.round((doneCount / PIPELINE_STEPS.length) * 100)
    : 0;

  return (
    <div className="min-h-screen bg-[#0d0d0f] text-white font-sans">
      {/* ── Ambient glow blobs ── */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-[500px] w-[600px] -translate-x-1/2 rounded-full bg-indigo-600/10 blur-[120px]" />
        <div className="absolute top-1/3 right-0 h-[400px] w-[400px] rounded-full bg-purple-700/8 blur-[100px]" />
      </div>

      {/* ── Header ── */}
      <header className="relative z-10 border-b border-white/6 bg-white/2 backdrop-blur-sm">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/20 text-lg">
              📈
            </div>
            <div>
              <h1 className="text-sm font-semibold text-white">
                Investment Research Agent
              </h1>
              <p className="text-xs text-white/35">
                Powered by Groq · Tavily · Yahoo Finance
              </p>
            </div>
          </div>
          {hasStarted && (
            <div className="flex items-center gap-2 text-xs text-white/40">
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${isRunning ? "bg-amber-400 animate-pulse" : isDone ? "bg-emerald-400" : "bg-white/20"}`}
              />
              {isRunning ? "Analysing…" : isDone ? "Complete" : "Idle"}
            </div>
          )}
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-2xl px-6 py-10 space-y-8">
        {/* ── Search section ── */}
        <section aria-label="Company search">
          <div className="mb-6 text-center">
            <h2 className="text-2xl font-bold tracking-tight text-white">
              Research any public company
            </h2>
            <p className="mt-1.5 text-sm text-white/40">
              Enter a company name — our agent will fetch live financials, news,
              and competitive data.
            </p>
          </div>

          <div className="flex gap-3">
            <input
              id="company-input"
              type="text"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void startResearch();
              }}
              placeholder="Apple, Reliance Industries, TSMC, Tesla…"
              disabled={isRunning}
              className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-white/25 outline-none transition-all focus:border-indigo-500/50 focus:bg-white/8 focus:ring-2 focus:ring-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-40"
            />
            <button
              id="research-button"
              onClick={() => void startResearch()}
              disabled={isRunning || !company.trim()}
              className="rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-600/25 transition-all hover:bg-indigo-500 hover:shadow-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-40 active:scale-95"
            >
              {isRunning ? "Running…" : "Research →"}
            </button>
          </div>
        </section>

        {/* ── Pipeline section ── */}
        {hasStarted && (
          <section aria-label="Pipeline progress">
            {/* Progress bar */}
            <div className="mb-4 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-widest text-white/30">
                Pipeline
              </span>
              <span className="text-xs text-white/30">{progress}%</span>
            </div>
            <div className="mb-4 h-0.5 w-full overflow-hidden rounded-full bg-white/5">
              <div
                className="h-full rounded-full bg-linear-to-r from-indigo-500 to-emerald-400 transition-all duration-700"
                style={{ width: `${progress}%` }}
              />
            </div>

            <div className="space-y-2">
              {PIPELINE_STEPS.map(({ key, label, icon }, i) => (
                <StepCard
                  key={key}
                  label={label}
                  icon={icon}
                  state={pipeline[key]}
                  index={i}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── Error ── */}
        {errorMessage && (
          <div
            role="alert"
            className="rounded-xl border border-red-500/20 bg-red-500/8 px-4 py-3 text-sm text-red-400"
          >
            <span className="font-semibold">Error: </span>
            {errorMessage}
          </div>
        )}

        {/* ── Results section ── */}
        {isDone && pipeline.synthesis.status === "done" && (
          <section aria-label="Research results" className="space-y-4">
            <span className="text-xs font-semibold uppercase tracking-widest text-white/30">
              Result
            </span>

            {/* Verdict badge */}
            {synthesisVerdict && (
              <div
                className={`flex items-center gap-3 rounded-xl border p-5 ${
                  synthesisVerdict === "INVEST"
                    ? "border-emerald-500/25 bg-emerald-500/8"
                    : synthesisVerdict === "PENDING"
                      ? "border-indigo-500/25 bg-indigo-500/8"
                      : "border-red-500/25 bg-red-500/8"
                }`}
              >
                <span className="text-3xl">
                  {synthesisVerdict === "INVEST"
                    ? "✅"
                    : synthesisVerdict === "PENDING"
                      ? "⏳"
                      : "❌"}
                </span>
                <div>
                  <p
                    className={`text-xl font-bold ${synthesisVerdict === "INVEST" ? "text-emerald-400" : synthesisVerdict === "PENDING" ? "text-indigo-400" : "text-red-400"}`}
                  >
                    {synthesisVerdict}
                  </p>
                  <p className="text-xs text-white/35 mt-0.5">
                    {synthesisVerdict === "PENDING"
                      ? "LLM synthesis will produce a full verdict in the next session."
                      : "AI-generated investment recommendation"}
                  </p>
                </div>
              </div>
            )}

            {/* Raw synthesis payload */}
            <div className="rounded-xl border border-white/6 bg-white/3">
              <div className="flex items-center justify-between border-b border-white/5 px-4 py-2.5">
                <span className="text-xs font-medium text-white/30">
                  Synthesis payload
                </span>
                <span className="rounded bg-white/5 px-2 py-0.5 text-xs text-white/20">
                  JSON
                </span>
              </div>
              <pre className="overflow-x-auto p-4 text-xs leading-relaxed text-white/50">
                {JSON.stringify(pipeline.synthesis.data, null, 2)}
              </pre>
            </div>
          </section>
        )}

        {/* ── Empty state hint ── */}
        {!hasStarted && (
          <div className="mt-8 grid grid-cols-3 gap-3">
            {["Apple", "Nvidia", "Reliance Industries"].map((name) => (
              <button
                key={name}
                onClick={() => {
                  setCompany(name);
                }}
                className="rounded-xl border border-white/6 bg-white/3 px-3 py-2.5 text-xs text-white/40 transition-all hover:border-indigo-500/30 hover:bg-indigo-500/8 hover:text-white/70"
              >
                {name}
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
