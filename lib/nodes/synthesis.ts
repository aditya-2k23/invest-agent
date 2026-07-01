// Pure LLM synthesis node — no HTTP, no Next.js concepts.
// Takes all research data collected by the preceding nodes and produces a
// structured investment verdict by calling Groq.

import Groq from "groq-sdk";
import { z } from "zod";
import type { CompanyProfile } from "./lookup.js";
import type { FinancialData } from "./financials.js";
import type { NewsData } from "./news.js";

// Schema (source of truth) and derived type
export const VerdictSchema = z.object({
  verdict: z.enum(["INVEST", "PASS"]),
  // 0–100 integer representing analyst confidence in the verdict.
  confidence: z.number().min(0).max(100),
  // One-paragraph executive summary of the investment thesis.
  summary: z.string(),
  // Up to 3 distinct bullish arguments.
  bullCase: z.array(z.string()).max(3),
  // Up to 3 distinct bearish arguments.
  bearCase: z.array(z.string()).max(3),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH"]),
  // Key financial metrics surfaced inline with sentiment labels.
  keyMetrics: z.array(
    z.object({
      label: z.string(),
      value: z.string(),
      sentiment: z.enum(["positive", "neutral", "negative"]),
    }),
  ),
});

export type Verdict = z.infer<typeof VerdictSchema>;

// Groq client — validated at module load so a missing key fails loudly on start
const apiKey = process.env.GROQ_API_KEY;
if (!apiKey) {
  throw new Error(
    "GROQ_API_KEY is not set. Add it to .env.local before running the server.",
  );
}

const groq = new Groq({ apiKey });
const MODEL = "llama-3.3-70b-versatile";

// Prompt builders
const SYSTEM_PROMPT = `You are a senior equity research analyst with 20 years of experience across technology, energy, healthcare, and consumer sectors. You have been asked to produce a structured investment verdict on a company based on the financial data, news headlines, and competitive context provided.

ANALYSIS FRAMEWORK
Weigh all three signal categories together — do not base the verdict on a single factor:
1. Financial health: profitability margins (gross, operating), valuation multiples (P/E, forward P/E, P/B), revenue growth trajectory, debt load (D/E ratio), liquidity (current ratio), and recent price performance relative to 52-week range.
2. News & sentiment: headlines should inform the macro/narrative backdrop — earnings beats, guidance changes, product launches, legal or regulatory risks, management changes.
3. Competitive position: market share trends, moat strength, peer pressure, and industry tailwinds or headwinds.

SIGNAL PRIORITY
When signals conflict, financial fundamentals (profitability, growth, balance sheet health) are the primary basis for the verdict. News sentiment should shift the verdict only when it reflects a structural risk to the business — regulatory action, legal liability, loss of competitive position, a leadership crisis, or a fundamental change to the business model. Short-term stock price movements, general market volatility, or single-day trading news are not structural risks and should not by themselves justify a PASS verdict when fundamentals are strong. Reflect short-term volatility in riskLevel or confidence if relevant, not as the deciding factor in the verdict itself.

VERDICT RULES
- INVEST: reserve this for companies showing a convergence of healthy financials, positive narrative, and a durable competitive position.
- PASS: use whenever signals are mixed, the valuation is stretched without clear justification, or meaningful risks are unresolved. PASS is not bearish — it means the risk/reward is not compelling enough right now.
- Prefer PASS with clear reasoning over INVEST with weak justification.

CONFIDENCE SCORING (0-100)
- High confidence (70-100): signals strongly agree across all three categories.
- Medium confidence (40-69): some signals conflict or data is incomplete.
- Low confidence (0-39): signals are contradictory, data is sparse, or the macro environment is highly uncertain.

BULL CASE / BEAR CASE
Each point must be a distinct, independently meaningful observation. Do not restate the same fact in different words across the two lists.

OUTPUT FORMAT
Respond ONLY with a single JSON object — no markdown, no code fences, no surrounding text. The JSON must conform to exactly this schema:
{
  "verdict": "INVEST" | "PASS",
  "confidence": <integer 0-100>,
  "summary": "<one paragraph>",
  "bullCase": ["<point 1>", "<point 2>", "<point 3>"],  // 1-3 items
  "bearCase": ["<point 1>", "<point 2>", "<point 3>"],  // 1-3 items
  "riskLevel": "LOW" | "MEDIUM" | "HIGH",
  "keyMetrics": [
    { "label": "<name>", "value": "<formatted value>", "sentiment": "positive" | "neutral" | "negative" }
  ]
}
keyMetrics must contain between 4 and 6 items. Always include at least one valuation metric (P/E or P/B), one profitability metric (gross or operating margin), one growth metric (revenue growth), and one balance sheet metric (D/E or current ratio).`;

// Format a nullable number as a percentage string; returns "N/A" if null.
function pct(value: number | null, decimals = 1): string {
  if (value === null) return "N/A";
  return `${(value * 100).toFixed(decimals)}%`;
}

// Format a nullable number as a plain decimal; returns "N/A" if null.
function num(value: number | null, decimals = 2): string {
  if (value === null) return "N/A";
  return value.toFixed(decimals);
}

// Format a large number (e.g. market cap) with B/T suffixes.
function large(value: number): string {
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  return `$${value.toFixed(0)}`;
}

function buildUserMessage(
  profile: CompanyProfile,
  financials: FinancialData,
  news: NewsData,
): string {
  const lines: string[] = [];

  // -- Company identity
  lines.push("=== COMPANY ===");
  lines.push(`Name:      ${profile.companyName}`);
  lines.push(`Ticker:    ${profile.ticker} (${profile.exchange})`);
  lines.push(`Sector:    ${profile.sector}`);
  lines.push(`Industry:  ${profile.industry}`);
  lines.push("");

  // -- Financial metrics
  lines.push("=== FINANCIALS ===");
  lines.push(`Current Price:      $${financials.currentPrice.toFixed(2)}`);
  lines.push(`Market Cap:         ${large(financials.marketCap)}`);
  lines.push(`52-Week High:       $${financials.week52High.toFixed(2)}`);
  lines.push(`52-Week Low:        $${financials.week52Low.toFixed(2)}`);
  lines.push(`Trailing P/E:       ${num(financials.peRatio)}`);
  lines.push(`Forward P/E:        ${num(financials.forwardPE)}`);
  lines.push(`Price-to-Book:      ${num(financials.priceToBook)}`);
  lines.push(`Gross Margin:       ${pct(financials.grossMargin)}`);
  lines.push(`Operating Margin:   ${pct(financials.operatingMargin)}`);
  lines.push(`Revenue Growth YoY: ${pct(financials.revenueGrowthYoY)}`);
  lines.push(`Debt-to-Equity:     ${num(financials.debtToEquity)}`);
  lines.push(`Current Ratio:      ${num(financials.currentRatio)}`);

  // Revenue trend (most recent 4 entries)
  if (financials.revenueHistory.length > 0) {
    lines.push("");
    lines.push("Revenue history (fiscal year end → total revenue):");
    financials.revenueHistory.slice(0, 4).forEach((r) => {
      lines.push(`  ${r.date}: ${large(r.revenue)}`);
    });
  }
  lines.push("");

  // -- General news (max 5)
  const generalSlice = news.generalNews.slice(0, 5);
  if (generalSlice.length > 0) {
    lines.push("=== GENERAL NEWS ===");
    generalSlice.forEach((a, i) => {
      lines.push(`[${i + 1}] ${a.title}`);
      lines.push(`    ${a.snippet.slice(0, 300)}`);
    });
    lines.push("");
  }

  // -- Financial news (max 5)
  const financialSlice = news.financialNews.slice(0, 5);
  if (financialSlice.length > 0) {
    lines.push("=== FINANCIAL NEWS ===");
    financialSlice.forEach((a, i) => {
      lines.push(`[${i + 1}] ${a.title}`);
      lines.push(`    ${a.snippet.slice(0, 300)}`);
    });
    lines.push("");
  }

  // -- Competitive news (max 3)
  const competitiveSlice = news.competitiveNews.slice(0, 3);
  if (competitiveSlice.length > 0) {
    lines.push("=== COMPETITIVE CONTEXT ===");
    competitiveSlice.forEach((a, i) => {
      lines.push(`[${i + 1}] ${a.title}`);
      lines.push(`    ${a.snippet.slice(0, 300)}`);
    });
    lines.push("");
  }

  lines.push("Produce the investment verdict JSON now.");
  return lines.join("\n");
}

// Main exported function
export async function synthesizeVerdict(input: {
  profile: CompanyProfile;
  financials: FinancialData;
  news: NewsData;
}): Promise<Verdict> {
  const { profile, financials, news } = input;

  const userMessage = buildUserMessage(profile, financials, news);

  let rawContent: string | null;
  try {
    const completion = await groq.chat.completions.create({
      model: MODEL,
      // json_object mode forces the model to output valid JSON — no markdown fences.
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      // Temperature 0.2 keeps the output deterministic enough for structured data
      // while allowing natural language variation in summary/case fields.
      temperature: 0.2,
    });

    rawContent = completion.choices[0]?.message?.content ?? null;
  } catch (err) {
    throw new Error(
      `Groq synthesis call failed for "${profile.companyName}" (${profile.ticker}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!rawContent) {
    throw new Error(
      `Groq returned an empty response for "${profile.companyName}" (${profile.ticker}).`,
    );
  }

  // Parse JSON then validate against the schema so any schema drift is caught early.
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    throw new Error(
      `Groq response was not valid JSON for "${profile.companyName}". Raw output (first 500 chars): ${rawContent.slice(0, 500)}`,
    );
  }

  const result = VerdictSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Groq response failed schema validation for "${profile.companyName}".\n` +
        `Zod errors: ${JSON.stringify(result.error.issues)}\n` +
        `Raw output (first 500 chars): ${rawContent.slice(0, 500)}`,
    );
  }

  return result.data;
}
