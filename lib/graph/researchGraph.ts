/**
 * researchGraph.ts
 * LangGraph StateGraph orchestration layer.
 *
 * External contract is identical to the previous async-generator version:
 *   export type ResearchUpdate = ...        (unchanged discriminated union)
 *   export async function* runResearchGraph(company: string): AsyncGenerator<ResearchUpdate>
 *
 * Internally this file builds a compiled StateGraph and adapts the node-by-node
 * "updates" stream into the same ResearchUpdate sequence the route handler expects.
 * No other file is modified.
 */

import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import { lookupCompany } from "../nodes/lookup";
import { fetchFinancials } from "../nodes/financials";
import { fetchNews } from "../nodes/news";
import { synthesizeVerdict } from "../nodes/synthesis";
import type { CompanyProfile } from "../nodes/lookup";
import type { FinancialData } from "../nodes/financials";
import type { NewsData } from "../nodes/news";
import type { Verdict } from "../nodes/synthesis";

// ResearchUpdate — exported discriminated union (unchanged from v1)
export type ResearchUpdate =
  | { step: "start"; status: "running"; company: string; data?: unknown }
  | { step: "lookup"; status: "running" | "done"; data?: unknown }
  | { step: "financials"; status: "running" | "done"; data?: unknown }
  | { step: "news"; status: "running" | "done"; data?: unknown }
  | { step: "competitive"; status: "running" | "done"; data?: unknown }
  | { step: "synthesis"; status: "running" | "done"; data?: unknown }
  | { step: "done"; status: "complete"; data?: unknown }
  | { step: "error"; status: "failed"; message: string };

// Graph state — defined with Annotation.Root
// All nullable fields use last-write-wins semantics.
// `company` is supplied at invocation time and never overwritten.
const GraphState = Annotation.Root({
  company: Annotation<string>({
    default: () => "",
    reducer: (_, b) => b,
  }),
  profile: Annotation<CompanyProfile | null>({
    default: () => null,
    reducer: (_, b) => b,
  }),
  financials: Annotation<FinancialData | null>({
    default: () => null,
    reducer: (_, b) => b,
  }),
  news: Annotation<NewsData | null>({
    default: () => null,
    reducer: (_, b) => b,
  }),
  verdict: Annotation<Verdict | null>({
    default: () => null,
    reducer: (_, b) => b,
  }),
});

// Convenience type alias for the fully-resolved state object.
type State = typeof GraphState.State;

// Node functions — thin wrappers around the pure async functions in lib/nodes/
async function lookupNode(state: State): Promise<Partial<State>> {
  const profile = await lookupCompany(state.company);
  return { profile };
}

async function financialsNode(state: State): Promise<Partial<State>> {
  const financials = await fetchFinancials(state.profile!);
  return { financials };
}

async function newsNode(state: State): Promise<Partial<State>> {
  const news = await fetchNews(state.profile!);
  return { news };
}

// competitiveNode is a no-op at the data level — the competitive articles
// are already inside state.news.competitiveNews. Returning {} causes LangGraph
// to record this node as completed and emit an "updates" event for it, so the
// UI card transitions correctly without an extra network call.
function competitiveNode(_state: State): Partial<State> {
  return {};
}

async function synthesisNode(state: State): Promise<Partial<State>> {
  const verdict = await synthesizeVerdict({
    profile: state.profile!,
    financials: state.financials!,
    news: state.news!,
  });
  return { verdict };
}

// Graph definition and compilation
const graph = new StateGraph(GraphState)
  .addNode("lookup", lookupNode)
  .addNode("fetchFinancials", financialsNode)
  .addNode("fetchNews", newsNode)
  .addNode("competitive", competitiveNode)
  .addNode("synthesis", synthesisNode)
  .addEdge(START, "lookup")
  .addEdge("lookup", "fetchFinancials")
  .addEdge("fetchFinancials", "fetchNews")
  .addEdge("fetchNews", "competitive")
  .addEdge("competitive", "synthesis")
  .addEdge("synthesis", END);

const compiledGraph = graph.compile();

// Public generator — adapts the LangGraph "updates" stream into ResearchUpdate
// The "updates" stream emits one event per completed node, shaped as:
//   Record<nodeName, partialState>
// e.g. { lookup: { profile: {...} } }
//
// Because "updates" events fire *after* a node completes (not before it starts),
// we synthesise "running" frames manually:
//   - yield lookup:running immediately before the stream loop
//   - for each event, yield <next-node>:running then yield <current-node>:done
export async function* runResearchGraph(
  company: string,
): AsyncGenerator<ResearchUpdate> {
  // Track the news payload in a local variable so the competitive node
  // (which returns {}) can still supply competitiveNews to its "done" frame.
  let capturedNews: NewsData | null = null;

  try {
    const stream = await compiledGraph.stream(
      { company },
      { streamMode: "updates" },
    );

    // Emit "lookup running" before the loop — LangGraph fires events only
    // after a node finishes, so the first event we receive is lookup:done.
    // Yielding the running frame here keeps the UI in sync.
    yield { step: "lookup", status: "running" };

    for await (const event of stream) {
      // event shape: { [nodeName]: partialState }
      const nodeName = Object.keys(event)[0] as string;
      const payload = (event as Record<string, unknown>)[nodeName] as Record<
        string,
        unknown
      >;

      if (nodeName === "lookup") {
        yield { step: "lookup", status: "done", data: payload.profile };
        yield { step: "financials", status: "running" };
      } else if (nodeName === "fetchFinancials") {
        yield { step: "financials", status: "done", data: payload.financials };
        yield { step: "news", status: "running" };
      } else if (nodeName === "fetchNews") {
        capturedNews = payload.news as NewsData;
        yield { step: "news", status: "done", data: capturedNews };
        yield { step: "competitive", status: "running" };
      } else if (nodeName === "competitive") {
        // competitiveNode returns {} — reconstruct the articles from the
        // captured news state rather than reading from the empty payload.
        yield {
          step: "competitive",
          status: "done",
          data: { articles: capturedNews?.competitiveNews ?? [] },
        };
        yield { step: "synthesis", status: "running" };
      } else if (nodeName === "synthesis") {
        yield { step: "synthesis", status: "done", data: payload.verdict };
      }
    }
  } catch (err) {
    // Yield the error as a stream frame so the client can display it.
    // We return instead of rethrowing to avoid a double error frame from route.ts.
    yield {
      step: "error",
      status: "failed",
      message: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
