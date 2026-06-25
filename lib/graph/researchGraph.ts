/**
 * researchGraph.ts
 * Pure generator layer — no HTTP, no Next.js concepts.
 * The route handler iterates this generator and streams each yielded update
 * as an NDJSON line to the client.
 */

import { lookupCompany } from "../nodes/lookup";
import { fetchFinancials } from "../nodes/financials";
import { fetchNews } from "../nodes/news";

// Types
/** Discriminated union over every event shape the stream can emit. */
export type ResearchUpdate =
  | { step: "start"; status: "running"; company: string; data?: unknown }
  | { step: "lookup"; status: "running" | "done"; data?: unknown }
  | { step: "financials"; status: "running" | "done"; data?: unknown }
  | { step: "news"; status: "running" | "done"; data?: unknown }
  | { step: "competitive"; status: "running" | "done"; data?: unknown }
  | { step: "synthesis"; status: "running" | "done"; data?: unknown }
  | { step: "done"; status: "complete"; data?: unknown }
  | { step: "error"; status: "failed"; message: string };

// Generator
/**
 * Runs the full research pipeline for a given company name, yielding a
 * "running" update before each step and a "done" update with real data after.
 * Errors are caught and yielded as an error frame — never rethrown — so the
 * route handler's own try/catch doesn't produce a second error frame in the stream.
 */
export async function* runResearchGraph(
  company: string,
): AsyncGenerator<ResearchUpdate> {
  try {
    // Step 1 — resolve company name to ticker + profile metadata
    yield { step: "lookup", status: "running" };
    const profile = await lookupCompany(company);
    yield { step: "lookup", status: "done", data: profile };

    // Step 2 — fetch price, ratios, and revenue history from Yahoo Finance
    yield { step: "financials", status: "running" };
    const financials = await fetchFinancials(profile);
    yield { step: "financials", status: "done", data: financials };

    // Step 3 — fetch general, financial, and competitive news from Tavily
    yield { step: "news", status: "running" };
    const news = await fetchNews(profile);
    yield { step: "news", status: "done", data: news };

    // Step 4 — competitive: repackage the competitiveNews bucket already fetched
    // in step 3 as its own pipeline frame so the UI card transitions correctly.
    // No additional network call is made here.
    yield { step: "competitive", status: "running" };
    yield {
      step: "competitive",
      status: "done",
      data: { articles: news.competitiveNews },
    };

    // Step 5 — synthesis placeholder until the LLM node is wired in
    yield { step: "synthesis", status: "running" };
    yield {
      step: "synthesis",
      status: "done",
      data: {
        verdict: "PENDING",
        note: "LLM synthesis node not yet implemented",
      },
    };

    yield { step: "done", status: "complete" };
  } catch (err) {
    // Yield the error as a stream frame so the client can display it.
    // We return instead of rethrowing to avoid a second error frame from route.ts.
    yield {
      step: "error",
      status: "failed",
      message: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
