// Pure data-fetching node — no HTTP, no LangGraph state.
// Called by the lookup step in the research graph.

// v3 changed the API: the default export is a class, not a singleton instance.
import YahooFinance from "yahoo-finance2";

// Module-level instance — created once, reused across calls.
// suppressNotices silences the one-time survey prompt that clutters logs.
const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

export interface CompanyProfile {
  ticker: string;
  companyName: string;
  sector: string;
  industry: string;
  exchange: string;
}

export async function lookupCompany(query: string): Promise<CompanyProfile> {
  // --- 1. Resolve the free-text query to a ticker symbol ---
  let searchResult;
  try {
    searchResult = await yf.search(query);
  } catch (err) {
    throw new Error(
      `Yahoo Finance search failed for "${query}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // The quotes array is a union of many instrument types; we only want equities.
  // quoteType === "EQUITY" is the stable enum discriminant for stock listings.
  const equity = searchResult.quotes.find(
    (q): q is typeof q & { quoteType: "EQUITY"; symbol: string; exchange: string; longname?: string; shortname?: string } =>
      "quoteType" in q && q.quoteType === "EQUITY",
  );

  if (!equity) {
    throw new Error(`Could not resolve company: ${query}`);
  }

  const ticker = equity.symbol;

  // --- 2. Fetch sector / industry / exchange from assetProfile ---
  let summary;
  try {
    summary = await yf.quoteSummary(ticker, {
      modules: ["assetProfile"],
    });
  } catch (err) {
    throw new Error(
      `Failed to fetch asset profile for "${ticker}" (resolved from "${query}"): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const profile = summary.assetProfile;

  // assetProfile is optional in QuoteSummaryResult; some tickers (ETFs, crypto)
  // don't have it even though we filtered to EQUITY — guard here to be safe.
  if (!profile) {
    throw new Error(
      `No asset profile returned for ticker "${ticker}" (resolved from "${query}")`,
    );
  }

  // longname from search is the most reliable display name; fall back to shortname,
  // then the raw query string if neither is present.
  const companyName = equity.longname ?? equity.shortname ?? query;

  // sector / industry / exchange can be absent for newly listed or foreign tickers;
  // fall back to empty string so the interface stays fully typed without nulls.
  return {
    ticker,
    companyName,
    sector: profile.sector ?? "",
    industry: profile.industry ?? "",
    // exchange from the search result (e.g. "NMS", "BOM") is more reliable
    // than the one buried in assetProfile which is sometimes absent.
    exchange: equity.exchange,
  };
}
