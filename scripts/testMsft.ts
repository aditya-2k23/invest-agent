// Microsoft re-test after SYSTEM_PROMPT fixes.
// Run with: npx tsx --env-file=.env.local scripts/testMsft.ts

import { runResearchGraph, type ResearchUpdate } from "../lib/graph/researchGraph";
import type { Verdict } from "../lib/nodes/synthesis";

async function main(): Promise<void> {
  console.log("▶  Microsoft re-test (post SYSTEM_PROMPT fixes)\n");

  let verdict: Verdict | null = null;
  let newsCounts: { general: number; financial: number; competitive: number } | null = null;

  for await (const update of runResearchGraph("Microsoft")) {
    const u = update as ResearchUpdate & { data?: unknown };

    if (u.step === "error") {
      console.error("Pipeline error:", (u as { message: string }).message);
      process.exit(1);
    }

    if (u.step === "news" && u.status === "done") {
      const nd = u.data as { generalNews: unknown[]; financialNews: unknown[]; competitiveNews: unknown[] };
      newsCounts = {
        general:     nd.generalNews.length,
        financial:   nd.financialNews.length,
        competitive: nd.competitiveNews.length,
      };
      console.log(`[news] general=${newsCounts.general}  financial=${newsCounts.financial}  competitive=${newsCounts.competitive}`);
    } else if (u.step === "synthesis" && u.status === "done") {
      verdict = u.data as Verdict;
      console.log("\n[synthesis] full output:");
      console.log(JSON.stringify(verdict, null, 2));
    } else {
      console.log(`[${u.step}] ${u.status}`);
    }
  }

  if (!verdict) { console.error("No synthesis verdict produced."); process.exit(1); }

  console.log("\n── BEFORE vs AFTER comparison ──");
  console.log(`verdict:     PASS → ${verdict.verdict}`);
  console.log(`confidence:  60   → ${verdict.confidence}`);
  console.log(`keyMetrics:  3    → ${verdict.keyMetrics.length} items`);
  console.log("keyMetric labels:", verdict.keyMetrics.map((m) => m.label).join(", "));
  const hasNewField = verdict.keyMetrics.some((m) =>
    ["Operating Margin", "Price-to-Book", "Current Ratio", "Gross Margin", "Market Cap", "52-Week"].some((f) =>
      m.label.toLowerCase().includes(f.toLowerCase()),
    ),
  );
  console.log(`previously-missing field present: ${hasNewField ? "YES ✓" : "NO ✗"}`);
}

main().catch((err: unknown) => {
  console.error("Fatal:", err);
  process.exit(1);
});
