# AI Investment Research Agent

> **Live demo:** _add your Vercel URL here_

An AI-powered investment research assistant that takes a company name, runs a multi-step research pipeline, and returns a structured **INVEST / PASS** verdict with confidence score, bull/bear analysis, risk level, and key financial metrics — all streamed to the browser in real time.

Built as an internship assignment to demonstrate end-to-end AI agent engineering: orchestrated data fetching, structured LLM output, and a production-ready streaming UI.

## Architecture

```
Browser (Next.js App Router — React 19)
    │
    │  POST /api/research   { company: "Apple" }
    │  ← NDJSON stream (one JSON object per line, flushed as each step completes)
    ▼
app/api/research/route.ts       ← HTTP layer: validates input (Zod), drives generator, streams output
    │
    ▼
lib/graph/researchGraph.ts      ← LangGraph StateGraph orchestrator (compiled graph)
    │
    ├─► [lookup node]           lib/nodes/lookup.ts
    │       yahoo-finance2.search() → CompanyProfile { ticker, sector, exchange, … }
    │
    ├─► [fetchFinancials node]  lib/nodes/financials.ts
    │       yahoo-finance2.quoteSummary() → FinancialData { P/E, margins, D/E, … }
    │
    ├─► [fetchNews node]        lib/nodes/news.ts
    │       Tavily search × 3 buckets → NewsData { generalNews, financialNews, competitiveNews }
    │
    ├─► [competitive node]      (no-op — data already in newsData.competitiveNews)
    │
    └─► [synthesis node]        lib/nodes/synthesis.ts
            Groq (llama-3.3-70b-versatile) → Verdict { verdict, confidence, summary, … }
```

Data flows through a **LangGraph `StateGraph`** whose compiled form is streamed with `streamMode: "updates"`. Each completed node emits one event; the generator translates these into `ResearchUpdate` frames (NDJSON) that the frontend consumes as they arrive.

---

## Tech Stack

| Layer             | Technology                                 | Purpose                                    |
| ----------------- | ------------------------------------------ | ------------------------------------------ |
| Framework         | Next.js 16 (App Router)                    | SSR + API routes + streaming               |
| Language          | TypeScript (strict)                        | Type safety throughout                     |
| Styling           | Tailwind CSS v4                            | Utility-first light-mode UI                |
| AI Orchestration  | LangGraph.js `@langchain/langgraph` v1.4.4 | StateGraph pipeline                        |
| LLM               | Groq — `llama-3.3-70b-versatile`           | Fast structured JSON synthesis             |
| Financial data    | `yahoo-finance2`                           | Ticker lookup + financial metrics          |
| News search       | `@tavily/core`                             | Web search in three domain buckets         |
| Schema validation | Zod                                        | Request validation + LLM output validation |
| Streaming         | Web Streams API (`ReadableStream`)         | NDJSON over HTTP                           |

## Local Development

### Prerequisites

- Node.js 20+
- API keys for **Groq** and **Tavily**

### Setup

```bash
# 1. Clone and install
git clone <repo-url>
cd invest-agent
npm install

# 2. Set environment variables
cp .env.example .env.local
# Edit .env.local and fill in the two keys (see Environment Variables below)

# 3. Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Type a company name (e.g. "Apple", "Reliance Industries") and click **Research →**.

## Environment Variables

| Variable         | Required | Description                                                                       |
| ---------------- | -------- | --------------------------------------------------------------------------------- |
| `GROQ_API_KEY`   | ✅       | Groq Cloud API key — used by the synthesis node to call `llama-3.3-70b-versatile` |
| `TAVILY_API_KEY` | ✅       | Tavily web search API key — used by the news node for three parallel searches     |

Both must be present in `.env.local` for local runs. On Vercel, add them in **Project → Settings → Environment Variables**.

Neither key is ever sent to the browser; both are only accessed in server-side node code.

## Project Structure

```
invest-agent/
├── app/
│   ├── api/research/route.ts   # POST handler — Zod validation, NDJSON streaming
│   ├── page.tsx                # React UI — pipeline progress + structured results card
│   └── globals.css             # Light-mode base styles (Tailwind v4)
├── lib/
│   ├── graph/
│   │   └── researchGraph.ts    # LangGraph StateGraph + ResearchUpdate generator
│   └── nodes/
│       ├── lookup.ts           # yahoo-finance2 company search → CompanyProfile
│       ├── financials.ts       # yahoo-finance2 quoteSummary → FinancialData
│       ├── news.ts             # Tavily 3-bucket search → NewsData
│       └── synthesis.ts        # Groq LLM call → Verdict (Zod-validated)
└── scripts/
    ├── testGraph.ts            # Quick smoke-test — runs Apple through the full pipeline
    ├── testMulti.ts            # Multi-company coverage test (MSFT, INTC, RELIANCE)
    └── testMsft.ts             # Targeted Microsoft re-test (used during prompt calibration)
```

## Key Engineering Decisions & Trade-offs

### 1. LangGraph `StateGraph` instead of a plain `async` generator

**Initial approach:** The pipeline was first built as a hand-rolled `async function*` generator that called each node in sequence with explicit `await`. This worked but was essentially a linear script — no composability, no state management, no extensibility.

**Migration:** The generator was replaced with a compiled LangGraph `StateGraph`. Five node functions (thin wrappers over the existing pure async functions in `lib/nodes/`) are connected with `addEdge(START → lookup → fetchFinancials → fetchNews → competitive → synthesis → END)` and run via `compiledGraph.stream(input, { streamMode: "updates" })`.

**Trade-off:** The external interface (`ResearchUpdate` discriminated union, NDJSON stream shape) is completely unchanged — only the orchestration layer changed. The generator wrapper around the LangGraph stream synthesises "running" frames manually because the `"updates"` stream only emits _after_ a node completes, not before it starts.

**Gotcha encountered:** LangGraph v1.4.4 throws a hard error if any node name matches a state channel name. The `financials` and `news` nodes conflicted with the `financials` and `news` state fields. Fixed by renaming the LangGraph-internal node names to `fetchFinancials` / `fetchNews` — the external stream step names (`step: "financials"`, `step: "news"`) were unchanged.

### 2. Three-bucket news with deduplication

The news node runs three separate Tavily searches:

| Bucket            | Query pattern                                    | Purpose                              |
| ----------------- | ------------------------------------------------ | ------------------------------------ |
| `generalNews`     | `"<company> news 2024 2025"`                     | Macro narrative and recent headlines |
| `financialNews`   | `"<company> earnings revenue financial results"` | Earnings beats, guidance changes     |
| `competitiveNews` | `"<company> competitors market share industry"`  | Moat and peer pressure signals       |

After fetching, articles are deduplicated by URL across all three buckets so the LLM never sees the same article twice. The `competitive` LangGraph node is a deliberate **no-op** — it returns `{}` — because the competitive articles are already inside `state.news.competitiveNews`. The no-op node exists purely to emit a stream event for the UI "Competitive Analysis" card.

### 3. Zod-validated structured LLM output

The synthesis node forces `response_format: { type: "json_object" }` on the Groq call, then validates the raw JSON against a `VerdictSchema` Zod object before returning. If the schema validation fails (wrong field types, missing keys), a descriptive error including the first 500 characters of the raw LLM response is thrown — making prompt regressions immediately debuggable.

The `Verdict` TypeScript type is derived directly from `VerdictSchema` via `z.infer<typeof VerdictSchema>`, so the schema is the single source of truth for both runtime validation and static types.

### 4. Two prompt calibration bugs found through multi-company testing

A multi-company test (Apple, Microsoft, Intel, Reliance Industries) was run to validate the synthesis node against real data before shipping. Two miscalibrations were found:

**Bug 1 — keyMetrics count too low.** All four runs returned only 3 metrics despite 12+ financial fields being passed in the prompt (P/E, gross margin, operating margin, P/B, current ratio, market cap, 52-week range, D/E, revenue history). The model consistently self-selected the same three safe picks and stopped. Fixed by adding an explicit constraint to `SYSTEM_PROMPT`:

> _"keyMetrics must contain between 4 and 6 items. Always include at least one valuation metric (P/E or P/B), one profitability metric (gross or operating margin), one growth metric (revenue growth), and one balance sheet metric (D/E or current ratio)."_

**Bug 2 — news overriding strong fundamentals.** Microsoft was given a `PASS` verdict (confidence 60) despite elite fundamentals: 18.3% YoY revenue growth, 68.3% gross margin, 46.3% operating margin. The deciding bear-case anchor was a "17% stock decline in June — worst month since 2000" headline. A short-term price event was being weighted equally with structural financial data.

Fixed by adding a `SIGNAL PRIORITY` section to `SYSTEM_PROMPT`:

> _"When signals conflict, financial fundamentals are the primary basis for the verdict. News sentiment should shift the verdict only when it reflects a structural risk — regulatory action, legal liability, loss of competitive position, a leadership crisis, or a fundamental change to the business model. Short-term stock price movements are not structural risks and should not by themselves justify a PASS verdict when fundamentals are strong."_

After both fixes, Microsoft correctly returned `INVEST` (confidence 85) with 6 keyMetrics including the previously-missing gross margin, current ratio, and P/B fields.

### 5. `incomeStatementHistory` deprecation

`yahoo-finance2.quoteSummary()` with the `incomeStatementHistory` module has returned near-empty data since November 2024. Revenue history is instead fetched from `fundamentalsTimeSeries`, which continues to return accurate annual data. Both modules are requested in a single merged `quoteSummary` call to avoid an extra network round-trip.

## Deployment

This project is deployed on **Vercel**.

The `/api/research` route streams NDJSON over HTTP and can take 30–50 seconds end-to-end (three Tavily searches + one Groq call). The route exports:

```ts
export const maxDuration = 60; // in app/api/research/route.ts
```

This tells Vercel's runtime to allow up to 60 seconds before closing the function. Without this, the default 10-second timeout kills the pipeline mid-stream on the Hobby plan (which supports up to 60 s) and on Pro (which supports up to 300 s).

### Vercel setup checklist

1. Import the GitHub repository in the Vercel dashboard
2. Set `GROQ_API_KEY` and `TAVILY_API_KEY` in **Project → Settings → Environment Variables**
3. Deploy — no additional build configuration required (Next.js is auto-detected)

## Running the test scripts

```bash
# Full pipeline smoke-test (Apple)
npx tsx --env-file=.env.local scripts/testGraph.ts

# Multi-company coverage test (Microsoft, Intel, Reliance Industries)
npx tsx --env-file=.env.local scripts/testMulti.ts

# Microsoft-specific re-test (used during prompt calibration)
npx tsx --env-file=.env.local scripts/testMsft.ts
```
