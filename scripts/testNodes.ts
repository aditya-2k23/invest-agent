// Run with: npx tsx scripts/testNodes.ts

import { lookupCompany } from "../lib/nodes/lookup.js";
import { fetchFinancials } from "../lib/nodes/financials.js";

async function testCompany(query: string): Promise<void> {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`▶  Testing: "${query}"`);
  console.log("─".repeat(60));

  try {
    console.log("\n[1/2] lookupCompany...");
    const profile = await lookupCompany(query);
    console.log("  CompanyProfile:", JSON.stringify(profile, null, 2));

    console.log("\n[2/2] fetchFinancials...");
    const financials = await fetchFinancials(profile);

    // Print revenue history separately so the rest stays compact.
    const { revenueHistory, ...rest } = financials;
    console.log("  FinancialData (excl. history):", JSON.stringify(rest, null, 2));
    console.log(`  revenueHistory (${revenueHistory.length} entries):`);
    for (const entry of revenueHistory) {
      console.log(`    ${entry.date}  →  ${entry.revenue.toLocaleString()}`);
    }

    console.log(`\n✅  "${query}" passed.`);
  } catch (err) {
    console.error(`\n❌  "${query}" failed:`, err instanceof Error ? err.message : err);
  }
}

async function main(): Promise<void> {
  // US equity
  await testCompany("Apple");

  // International equity — Reliance Industries trades on BSE (ticker: RELIANCE.BO)
  // and NSE (RELIANCE.NS). This verifies that non-US search resolution works.
  await testCompany("Reliance Industries");

  console.log(`\n${"─".repeat(60)}`);
  console.log("All tests complete.");
}

main().catch((err: unknown) => {
  console.error("Fatal:", err);
  process.exit(1);
});
