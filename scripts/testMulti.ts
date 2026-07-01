// Temporary multi-company coverage test.
// Run with: npx tsx --env-file=.env.local scripts/testMulti.ts
// Intentionally not modifying testGraph.ts.

import {
  runResearchGraph,
  type ResearchUpdate,
} from "../lib/graph/researchGraph";
import type { NewsData } from "../lib/nodes/news";
import type { Verdict } from "../lib/nodes/synthesis";

// Companies under test:
//   1. Microsoft — large-cap, healthy fundamentals, strong INVEST candidate
//   2. Intel     — weak growth, competitive pressure, expected PASS candidate
//   3. Reliance Industries — non-US, verifies international ticker through synthesis
const COMPANIES = ["Microsoft", "Intel", "Reliance Industries"] as const;

interface RunResult {
  company: string;
  verdict: Verdict | null;
  newsArticleCounts: { general: number; financial: number; competitive: number } | null;
  error: string | null;
}

async function runOne(company: string): Promise<RunResult> {
  console.log(`\n${"═".repeat(64)}`);
  console.log(`▶  ${company}`);
  console.log("═".repeat(64));

  let capturedVerdict: Verdict | null = null;
  let capturedNewsCounts: RunResult["newsArticleCounts"] = null;
  let capturedError: string | null = null;

  try {
    for await (const update of runResearchGraph(company)) {
      const u = update as ResearchUpdate & { data?: unknown };
      const { data, ...rest } = u;

      if (u.step === "error") {
        capturedError = (u as { message: string }).message;
        console.log(`  ❌  ERROR: ${capturedError}`);
        break;
      }

      // Print concise one-liner per frame; expand synthesis data fully.
      if (u.step === "synthesis" && u.status === "done") {
        console.log(`  [synthesis done] → data: ${JSON.stringify(data, null, 2)}`);
        capturedVerdict = data as Verdict;
      } else if (u.step === "news" && u.status === "done") {
        const nd = data as NewsData;
        capturedNewsCounts = {
          general:     nd.generalNews.length,
          financial:   nd.financialNews.length,
          competitive: nd.competitiveNews.length,
        };
        console.log(
          `  [news done] general=${capturedNewsCounts.general}  financial=${capturedNewsCounts.financial}  competitive=${capturedNewsCounts.competitive}`,
        );
      } else {
        // For all other frames just log step + status
        console.log(`  [${u.step}] ${u.status}`);
      }
    }
  } catch (err) {
    capturedError = err instanceof Error ? err.message : String(err);
    console.error(`  Fatal: ${capturedError}`);
  }

  return { company, verdict: capturedVerdict, newsArticleCounts: capturedNewsCounts, error: capturedError };
}

async function main(): Promise<void> {
  const results: RunResult[] = [];

  for (const company of COMPANIES) {
    results.push(await runOne(company));
  }

  // Summary table
  console.log(`\n${"═".repeat(64)}`);
  console.log("SUMMARY");
  console.log("═".repeat(64));
  for (const r of results) {
    if (r.error) {
      console.log(`\n${r.company}: ERROR — ${r.error}`);
      continue;
    }
    const v = r.verdict!;
    const nc = r.newsArticleCounts!;
    console.log(`\n${r.company}`);
    console.log(`  verdict:     ${v.verdict}  (confidence: ${v.confidence}, risk: ${v.riskLevel})`);
    console.log(`  keyMetrics:  ${v.keyMetrics.length} items`);
    console.log(`  news counts: general=${nc.general}  financial=${nc.financial}  competitive=${nc.competitive}`);
    console.log(`  bull: ${v.bullCase.map((b, i) => `\n    [${i + 1}] ${b}`).join("")}`);
    console.log(`  bear: ${v.bearCase.map((b, i) => `\n    [${i + 1}] ${b}`).join("")}`);
    console.log(`  summary: "${v.summary}"`);
  }
}

main().catch((err: unknown) => {
  console.error("Fatal:", err);
  process.exit(1);
});
