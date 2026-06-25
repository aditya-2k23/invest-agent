// Pure data-fetching node — no HTTP, no LangGraph state.
// Called by the news step in the research graph.

import { tavily } from "@tavily/core";
import type { TavilyClient, TavilySearchResponse } from "@tavily/core";
import type { CompanyProfile } from "./lookup.js";

// TavilySearchResult is not exported by @tavily/core; derive it from the response type.
type TavilySearchResult = TavilySearchResponse["results"][number];

export type { CompanyProfile };

export interface NewsArticle {
  title: string;
  url: string;
  snippet: string;
  publishedDate: string | null;
  source: string | null;
}

export interface NewsData {
  generalNews: NewsArticle[];
  financialNews: NewsArticle[];
  queriesUsed: string[];
}

// Initialise the client once at module load time so missing keys are caught early.
// We throw here rather than inside fetchNews so the error surfaces at server startup.
const apiKey = process.env.TAVILY_API_KEY;
if (!apiKey) {
  throw new Error(
    "TAVILY_API_KEY is not set. Add it to .env.local before running the server.",
  );
}

const client: TavilyClient = tavily({ apiKey });

// Extract the hostname from a URL for use as the article source label.
// Returns null when the URL is malformed rather than crashing.
function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

// Map a raw Tavily result to our clean NewsArticle shape.
function toNewsArticle(result: TavilySearchResult): NewsArticle {
  return {
    title: result.title,
    url: result.url,
    // content is Tavily's scraped snippet; rename to snippet for clarity.
    snippet: result.content,
    // publishedDate is typed as string but may be an empty string in practice.
    publishedDate: result.publishedDate || null,
    source: extractDomain(result.url),
  };
}

export async function fetchNews(profile: CompanyProfile): Promise<NewsData> {
  const query1 = `${profile.companyName} latest news`;
  const query2 = `${profile.companyName} earnings revenue financial results 2024 2025`;

  // Fire both searches in parallel to halve the wall-clock latency.
  let generalResult, financialResult;
  try {
    [generalResult, financialResult] = await Promise.all([
      client.search(query1, { maxResults: 6, searchDepth: "basic" }),
      client.search(query2, { maxResults: 6, searchDepth: "advanced" }),
    ]);
  } catch (err) {
    throw new Error(
      `Tavily news search failed for "${profile.companyName}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const generalArticles = generalResult.results.map(toNewsArticle);
  const financialArticles = financialResult.results.map(toNewsArticle);

  // Deduplicate: build a Set of URLs that already appear in generalNews,
  // then filter them out of financialNews so the same article isn't shown twice.
  const generalUrls = new Set(generalArticles.map((a) => a.url));
  const dedupedFinancial = financialArticles.filter(
    (a) => !generalUrls.has(a.url),
  );

  return {
    generalNews: generalArticles,
    financialNews: dedupedFinancial,
    queriesUsed: [query1, query2],
  };
}
