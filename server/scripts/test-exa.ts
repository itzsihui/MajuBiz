/**
 * Manual Exa check — run from repo root:
 *   npm run test:exa -w server -- "shinchan cake carousell.sg"
 */
import "dotenv/config";
import { Exa } from "exa-js";

const query = process.argv.slice(2).join(" ") || "shinchan cake carousell.sg";
const apiKey = process.env.EXA_API_KEY;

if (!apiKey) {
  console.error("Missing EXA_API_KEY in server/.env");
  process.exit(1);
}

const exa = new Exa(apiKey);

console.log(`\nExa search: "${query}"\n`);

const result = await exa.search(query, {
  type: "auto",
  numResults: 10,
  includeDomains: ["carousell.sg"],
});

for (const [i, r] of (result.results ?? []).entries()) {
  console.log(`${i + 1}. ${r.title ?? "(no title)"}`);
  console.log(`   ${r.url ?? "(no url)"}`);
  if (r.highlights?.length) {
    console.log(`   highlight: ${r.highlights[0]?.slice(0, 120)}…`);
  }
  console.log();
}

console.log(`Total: ${result.results?.length ?? 0} results`);
