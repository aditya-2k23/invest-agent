/**
 * researchGraph.ts
 * Pure generator layer — no HTTP, no Next.js concepts.
 * The route handler calls this; LangGraph nodes will replace the fake delays later.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Discriminated union over every event shape the stream can emit. */
export type ResearchUpdate =
  | { step: "start";       status: "running";  company: string;  data?: unknown }
  | { step: "lookup";      status: "running" | "done"; data?: unknown }
  | { step: "financials";  status: "running" | "done"; data?: unknown }
  | { step: "news";        status: "running" | "done"; data?: unknown }
  | { step: "competitive"; status: "running" | "done"; data?: unknown }
  | { step: "synthesis";   status: "running" | "done"; data?: unknown }
  | { step: "done";        status: "complete"; data?: unknown }
  | { step: "error";       status: "failed";   message: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wraps setTimeout in a Promise so we can await it inside an async generator. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Placeholder datasets — typed as unknown so callers can't depend on the shape yet.
// Each will be replaced by real node output once LangGraph is wired up.
const STUB_DATA: Record<string, unknown> = {
  lookup:      { ticker: "AAPL", sector: "Technology", exchange: "NASDAQ" },
  financials:  { peRatio: 28.4, revenueGrowthYoY: 0.061, grossMargin: 0.454 },
  news:        { headlines: ["Apple unveils new chip", "Services revenue hits record"] },
  competitive: { peers: ["MSFT", "GOOGL", "META"], moat: "ecosystem lock-in" },
  synthesis:   { verdict: "INVEST", confidence: 0.82, summary: "Strong moat, consistent FCF growth." },
};

// Steps run in this exact order; the array drives the loop so there's one place to reorder them.
const PIPELINE_STEPS = ["lookup", "financials", "news", "competitive", "synthesis"] as const;
type PipelineStep = (typeof PIPELINE_STEPS)[number];

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

/**
 * Yields a "running" update before each step and a "done" update (with stub data) after.
 * The 800 ms delay simulates real async I/O; replace with actual node calls later.
 */
export async function* runResearchGraph(
  company: string
): AsyncGenerator<ResearchUpdate> {
  for (const step of PIPELINE_STEPS) {
    // Signal that this step has started.
    yield { step, status: "running" } satisfies ResearchUpdate;

    // Simulate the time a real LangGraph node would take.
    await delay(800);

    // Signal completion and attach stub data for end-to-end shape verification.
    yield {
      step,
      status: "done",
      data: STUB_DATA[step as PipelineStep],
    } satisfies ResearchUpdate;
  }

  yield { step: "done", status: "complete" };
}
