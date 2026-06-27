import "dotenv/config";
import { Exa } from "exa-js";

const url =
  process.argv[2] ??
  "https://www.carousell.sg/p/shin-chan-character-cakes-theme-cakes-birthday-cakes-customised-cakes-party-cakes-1445910996/";

const exa = new Exa(process.env.EXA_API_KEY!);
const r = await exa.getContents([url], {
  highlights: { query: "price SGD cake", maxCharacters: 800 },
});
console.log(JSON.stringify(r.results?.[0], null, 2));
