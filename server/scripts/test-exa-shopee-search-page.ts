import "dotenv/config";
import { Exa } from "exa-js";

const keyword = process.argv.slice(2).join(" ") || "bubble wrap";
const exa = new Exa(process.env.EXA_API_KEY!);
const searchUrl = `https://shopee.sg/search?keyword=${encodeURIComponent(keyword)}`;

console.log("Crawling:", searchUrl, "\n");

const r = await exa.getContents([searchUrl], {
  text: { maxCharacters: 8000 },
  highlights: { query: `bubble wrap product listing price SGD shopee`, maxCharacters: 2000 },
});

const page = r.results?.[0] as { text?: string; highlights?: string[]; title?: string };
const blob = [page?.text ?? "", ...(page?.highlights ?? [])].join("\n");

const urls = new Set<string>();
for (const m of blob.matchAll(/https?:\/\/shopee\.sg\/[^\s"'<>]+-i\.\d+\.\d+/gi)) {
  urls.add(m[0].split("?")[0]);
}

console.log("URLs found:", urls.size);
[...urls].slice(0, 10).forEach((u, i) => console.log(`${i + 1}. ${u}`));

if (urls.size === 0) {
  console.log("\nSample text:", blob.slice(0, 500));
}
