import "dotenv/config";
import { Exa } from "exa-js";

const keyword = process.argv.slice(2).join(" ") || "bubble wrap";
const exa = new Exa(process.env.EXA_API_KEY!);

const result = await exa.search(`${keyword} roll packaging`, {
  type: "auto",
  numResults: 20,
  includeDomains: ["shopee.sg"],
  includeText: ["bubble wrap"],
});

for (const [i, r] of (result.results ?? []).entries()) {
  const isProduct = r.url?.includes("-i.");
  console.log(`${i + 1}. ${isProduct ? "✓" : "·"} ${r.title?.slice(0, 70)}`);
  console.log(`   ${r.url}`);
}
console.log(`\nTotal: ${result.results?.length ?? 0}`);
