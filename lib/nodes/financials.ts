// Pure data-fetching node — no HTTP, no LangGraph state.
// Called by the financials step in the research graph.
// Receives an already-resolved CompanyProfile; does NO ticker resolution.

// v3 changed the API: the default export is a class, not a singleton instance.
import YahooFinance from "yahoo-finance2";
import type { CompanyProfile } from "./lookup.js";

// Module-level instance — created once, reused across calls.
// suppressNotices silences the one-time survey prompt that clutters logs.
const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

export type { CompanyProfile };

export interface FinancialData {
  ticker: string;
  companyName: string;
  currentPrice: number;
  marketCap: number;
  peRatio: number | null;
  forwardPE: number | null;
  priceToBook: number | null;
  revenueGrowthYoY: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  week52High: number;
  week52Low: number;
  revenueHistory: Array<{ date: string; revenue: number }>;
}

export async function fetchFinancials(
  profile: CompanyProfile,
): Promise<FinancialData> {
  const { ticker, companyName } = profile;

  // --- 1. Real-time quote: price, market cap, ratios, 52-week range ---
  let q;
  try {
    // Passing a plain string (not an array) returns a single Quote, not Quote[].
    q = await yf.quote(ticker);
  } catch (err) {
    throw new Error(
      `Failed to fetch quote for "${ticker}" (${companyName}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // regularMarketPrice is the last traded price during regular hours.
  // It can be undefined for delisted or illiquid securities.
  if (q.regularMarketPrice === undefined) {
    throw new Error(
      `No price data returned for "${ticker}" (${companyName}). The ticker may be delisted or unavailable.`,
    );
  }

  // marketCap can be undefined for very small or recently delisted tickers; default to 0.
  const marketCap = q.marketCap ?? 0;

  // fiftyTwoWeekHigh/Low live on QuoteBase (all instrument types). They are optional
  // because some tickers lack 52-week history (e.g. very recent listings).
  if (q.fiftyTwoWeekHigh === undefined || q.fiftyTwoWeekLow === undefined) {
    throw new Error(
      `52-week range unavailable for "${ticker}" (${companyName}).`,
    );
  }

  // --- 2. quoteSummary: margin/ratio fields + income statement history ---
  // We fetch two modules in a single round-trip to minimise network calls.
  // financialData has margin/ratio fields from Yahoo's own calculations.
  // incomeStatementHistory provides raw revenue figures per fiscal year.
  // NOTE: Yahoo deprecated incomeStatementHistory data in Nov 2024. If revenueHistory
  // starts returning empty arrays, migrate to fundamentalsTimeSeries module instead.
  let summary;
  try {
    summary = await yf.quoteSummary(ticker, {
      modules: ["financialData", "incomeStatementHistory"],
    });
  } catch (err) {
    throw new Error(
      `Failed to fetch financial summary for "${ticker}" (${companyName}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const fd = summary.financialData;
  const ish = summary.incomeStatementHistory;

  // --- 3. Map revenue history ---
  // incomeStatementHistory.incomeStatementHistory is annual (4 fiscal years by default).
  // Each element's endDate is a JS Date; we format it to an ISO date string for portability.
  const revenueHistory: FinancialData["revenueHistory"] = (
    ish?.incomeStatementHistory ?? []
  ).map((entry) => ({
    date: entry.endDate.toISOString().slice(0, 10), // "YYYY-MM-DD"
    revenue: entry.totalRevenue,
  }));

  // --- 4. Assemble the output ---
  // All optional Yahoo fields use ?? null so downstream code sees null, not undefined,
  // which keeps the FinancialData interface free of optional (?) members.
  return {
    ticker,
    companyName,
    currentPrice: q.regularMarketPrice,
    marketCap,
    // trailingPE is the trailing 12-month P/E; field name on QuoteBase is trailingPE.
    peRatio: q.trailingPE ?? null,
    // forwardPE exists on both QuoteBase and financialData; quote() is fresher.
    forwardPE: q.forwardPE ?? null,
    priceToBook: q.priceToBook ?? null,
    // revenueGrowth from financialData is Yahoo's own YoY calculation (trailing).
    revenueGrowthYoY: fd?.revenueGrowth ?? null,
    // grossMargins (note the plural) is Yahoo's field name; we alias to grossMargin.
    grossMargin: fd?.grossMargins ?? null,
    // operatingMargins (plural) — same aliasing pattern as above.
    operatingMargin: fd?.operatingMargins ?? null,
    // debtToEquity is expressed as a ratio (e.g. 150 means 150%), not a decimal.
    debtToEquity: fd?.debtToEquity ?? null,
    currentRatio: fd?.currentRatio ?? null,
    week52High: q.fiftyTwoWeekHigh,
    week52Low: q.fiftyTwoWeekLow,
    revenueHistory,
  };
}
