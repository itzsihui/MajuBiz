import "dotenv/config";
import { Exa } from "exa-js";

const query = process.argv.slice(2).join(" ") || "bubble wrap";
const exa = new Exa(process.env.EXA_API_KEY!);

const result = await exa.search(query, {
  type: "auto",
  numResults: 15,
  includeDomains: ["shopee.sg"],
});

for (const [i, r] of (result.results ?? []).entries()) {
  console.log(`${i + 1}. ${r.title ?? "(no title)"}`);
  console.log(`   ${r.url ?? ""}`);
}
console.log(`\nTotal: ${result.results?.length ?? 0}`);
