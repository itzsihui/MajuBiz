import "dotenv/config";
import { Exa } from "exa-js";

const exa = new Exa(process.env.EXA_API_KEY!);
const shops = [
  "https://shopee.sg/millionparcel",
  "https://shopee.sg/search?keyword=bubble%20wrap&page=0",
];

for (const url of shops) {
  console.log("\n===", url, "===\n");
  const r = await exa.getContents([url], {
    text: { maxCharacters: 10000 },
    highlights: { query: "bubble wrap roll price SGD product", maxCharacters: 3000 },
  });
  const page = r.results?.[0] as { text?: string; highlights?: string[] };
  const blob = [page?.text ?? "", ...(page?.highlights ?? [])].join("\n");
  const urls = [...blob.matchAll(/shopee\.sg\/[^\s"'<>]+-i\.\d+\.\d+/gi)].map((m) => `https://${m[0].split("?")[0]}`);
  console.log("product urls:", urls.length);
  urls.slice(0, 8).forEach((u, i) => console.log(`${i + 1}. ${u}`));
  if (!urls.length) console.log("sample:", blob.slice(0, 400));
}
