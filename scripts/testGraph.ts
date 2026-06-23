// Recommended: npx tsx scripts/testGraph.ts
// (tsx handles Next.js "moduleResolution": "bundler" automatically, no config needed)
//
// Fallback (ts-node requires ESM flag and may need tsconfig override):
//   npx ts-node --esm scripts/testGraph.ts

import {
  runResearchGraph,
  type ResearchUpdate,
} from "../lib/graph/researchGraph";

async function main(): Promise<void> {
  console.log("▶  Starting research pipeline for: Apple\n");

  for await (const update of runResearchGraph("Apple")) {
    // Pretty-print so step/status stand out, data is collapsed.
    const { data, ...rest } = update as ResearchUpdate & { data?: unknown };
    console.log(
      JSON.stringify(rest),
      data !== undefined ? `→ data: ${JSON.stringify(data)}` : "",
    );
  }

  console.log("\n✅  Pipeline complete.");
}

main().catch((err: unknown) => {
  console.error("Pipeline failed:", err);
  process.exit(1);
});
