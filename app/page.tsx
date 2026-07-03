"use client";

import { useState, useRef } from "react";
import type { Verdict } from "../lib/nodes/synthesis";

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

// Safe cast — returns null if data doesn't match the Verdict shape
function asVerdict(data: unknown): Verdict | null {
  if (
    data !== null &&
    typeof data === "object" &&
    "verdict" in data &&
    "confidence" in data &&
    "summary" in data &&
    "bullCase" in data &&
    "bearCase" in data &&
    "riskLevel" in data &&
    "keyMetrics" in data
  ) {
    return data as Verdict;
  }
  return null;
}

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
          ? "border-amber-400/60 bg-amber-50 shadow-lg shadow-amber-100"
          : isDone
            ? "border-emerald-400/50 bg-emerald-50"
            : isIdle
              ? "border-slate-200 bg-white"
              : "border-red-400/50 bg-red-50"
      }`}
    >
      {/* Step number badge */}
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold transition-colors duration-500 ${
          isRunning
            ? "bg-amber-400 text-white"
            : isDone
              ? "bg-emerald-500 text-white"
              : "bg-slate-100 text-slate-400"
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
              ? "text-slate-800"
              : isDone
                ? "text-slate-700"
                : "text-slate-400"
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
              ? "text-amber-500"
              : isDone
                ? "text-emerald-600"
                : "text-slate-300"
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

// Verdict results card — rendered once synthesis is done
function VerdictCard({ verdict }: { verdict: Verdict }) {
  const confidenceColor =
    verdict.confidence >= 70
      ? "bg-emerald-400"
      : verdict.confidence >= 40
        ? "bg-amber-400"
        : "bg-red-400";

  const riskStyles: Record<string, string> = {
    LOW: "bg-emerald-50 text-emerald-700 border-emerald-300",
    MEDIUM: "bg-amber-50 text-amber-700 border-amber-300",
    HIGH: "bg-red-50 text-red-700 border-red-300",
  };

  const sentimentColor = (s: "positive" | "neutral" | "negative") =>
    s === "positive"
      ? "text-emerald-600"
      : s === "negative"
        ? "text-red-500"
        : "text-slate-600";

  return (
    <div className="space-y-3">
      {/* 1. Summary card */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-4">
        <p className="text-sm text-slate-600 leading-relaxed">
          {verdict.summary}
        </p>
      </div>

      {/* 2. Confidence + risk row */}
      <div className="grid grid-cols-2 gap-3">
        {/* Confidence */}
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs text-slate-400">Confidence</p>
          <p className="mt-0.5 text-sm font-semibold text-slate-800">
            {verdict.confidence}%
          </p>
          <div className="mt-2 h-0.5 w-full rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full transition-all duration-700 ${confidenceColor}`}
              style={{ width: `${verdict.confidence}%` }}
            />
          </div>
        </div>

        {/* Risk level */}
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs text-slate-400">Risk</p>
          <div className="mt-1.5">
            <span
              className={`rounded-full border px-3 py-0.5 text-xs font-semibold ${riskStyles[verdict.riskLevel] ?? riskStyles["MEDIUM"]}`}
            >
              {verdict.riskLevel}
            </span>
          </div>
        </div>
      </div>

      {/* 3. Bull / Bear two-column grid */}
      <div className="grid grid-cols-2 gap-3">
        {/* Bull case */}
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">
            ▲ Bull Case
          </p>
          <ul className="mt-2 space-y-2">
            {verdict.bullCase.map((point, i) => (
              <li
                key={i}
                className="flex items-start text-xs text-slate-600 leading-relaxed"
              >
                <span className="mr-2 mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                {point}
              </li>
            ))}
          </ul>
        </div>

        {/* Bear case */}
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-red-500">
            ▼ Bear Case
          </p>
          <ul className="mt-2 space-y-2">
            {verdict.bearCase.map((point, i) => (
              <li
                key={i}
                className="flex items-start text-xs text-slate-600 leading-relaxed"
              >
                <span className="mr-2 mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
                {point}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* 4. Key metrics grid */}
      <div className="grid grid-cols-3 gap-2">
        {verdict.keyMetrics.map((metric, i) => (
          <div
            key={i}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2.5"
          >
            <p className="text-xs text-slate-400 truncate">{metric.label}</p>
            <p
              className={`mt-0.5 text-sm font-semibold ${sentimentColor(metric.sentiment)}`}
            >
              {metric.value}
            </p>
          </div>
        ))}
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

  const verdict = asVerdict(synthesisData);

  const doneCount = PIPELINE_STEPS.filter(
    (s) => pipeline[s.key].status === "done",
  ).length;
  const progress = hasStarted
    ? Math.round((doneCount / PIPELINE_STEPS.length) * 100)
    : 0;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      {/* ── Subtle top gradient accent ── */}
      <div className="pointer-events-none fixed inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-indigo-400/40 to-transparent" />

      {/* ── Header ── */}
      <header className="relative z-10 border-b border-slate-200 bg-white shadow-sm">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100 text-lg">
              📈
            </div>
            <div>
              <h1 className="text-sm font-semibold text-slate-800">
                Investment Research Agent
              </h1>
              <p className="text-xs text-slate-400">
                Powered by Groq · Tavily · Yahoo Finance
              </p>
            </div>
          </div>
          {hasStarted && (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${isRunning ? "bg-amber-400 animate-pulse" : isDone ? "bg-emerald-500" : "bg-slate-300"}`}
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
            <h2 className="text-2xl font-bold tracking-tight text-slate-900">
              Research any public company
            </h2>
            <p className="mt-1.5 text-sm text-slate-500">
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
              className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 placeholder-slate-400 outline-none shadow-sm transition-all focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:opacity-40"
            />
            <button
              id="research-button"
              onClick={() => void startResearch()}
              disabled={isRunning || !company.trim()}
              className="rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-md shadow-indigo-200 transition-all hover:bg-indigo-500 hover:shadow-indigo-300 disabled:cursor-not-allowed disabled:opacity-40 active:scale-95"
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
              <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                Pipeline
              </span>
              <span className="text-xs text-slate-400">{progress}%</span>
            </div>
            <div className="mb-4 h-0.5 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-linear-to-r from-indigo-500 to-emerald-500 transition-all duration-700"
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
            className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600"
          >
            <span className="font-semibold">Error: </span>
            {errorMessage}
          </div>
        )}

        {/* ── Results section ── */}
        {isDone && pipeline.synthesis.status === "done" && (
          <section aria-label="Research results" className="space-y-4">
            <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">
              Result
            </span>

            {/* Verdict badge */}
            {synthesisVerdict && (
              <div
                className={`flex items-center gap-3 rounded-xl border p-5 ${
                  synthesisVerdict === "INVEST"
                    ? "border-emerald-200 bg-emerald-50"
                    : synthesisVerdict === "PENDING"
                      ? "border-indigo-200 bg-indigo-50"
                      : "border-red-200 bg-red-50"
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
                    className={`text-xl font-bold ${synthesisVerdict === "INVEST" ? "text-emerald-600" : synthesisVerdict === "PENDING" ? "text-indigo-600" : "text-red-500"}`}
                  >
                    {synthesisVerdict}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {synthesisVerdict === "PENDING"
                      ? "LLM synthesis will produce a full verdict in the next session."
                      : "AI-generated investment recommendation"}
                  </p>
                </div>
              </div>
            )}

            {/* Structured verdict card — replaces raw JSON dump */}
            {verdict ? (
              <VerdictCard verdict={verdict} />
            ) : (
              /* Safety-net fallback: show raw JSON if verdict shape is unexpected */
              <div className="rounded-xl border border-slate-200 bg-white">
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
                  <span className="text-xs font-medium text-slate-400">
                    Synthesis payload
                  </span>
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-400">
                    JSON
                  </span>
                </div>
                <pre className="overflow-x-auto p-4 text-xs leading-relaxed text-slate-500">
                  {JSON.stringify(pipeline.synthesis.data, null, 2)}
                </pre>
              </div>
            )}
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
                className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-500 shadow-sm transition-all hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-600"
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
