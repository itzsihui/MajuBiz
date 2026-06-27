import { Exa } from "exa-js";
import type { Agent, ScrapeResult } from "../types.js";

const FALLBACK: ScrapeResult = {
  source: "fallback",
  supplier: "Demo supplier (Exa not configured)",
  product: "Bubble wrap bulk",
  price: 9.5,
  currency: "SGD",
  url: "",
  matched: true,
  highlights: ["Demo data — add EXA_API_KEY to server/.env for live Shopee/Carousell listings"],
};

function isListingUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.pathname.includes("/search")) return false;
    if (u.hostname.includes("shopee.sg") && u.pathname.includes("-i.")) return true;
    if (u.hostname.includes("carousell.sg") && u.pathname.includes("/p/")) return true;
    if (u.hostname.includes("lazada.sg") && u.pathname.includes("/products/")) return true;
    return !u.pathname.includes("/search");
  } catch {
    return false;
  }
}

function parsePriceFromText(text: string): number | null {
  const match = text.match(/S\$?\s*(\d+(?:\.\d{1,2})?)/i);
  return match ? parseFloat(match[1]) : null;
}

export async function scrapePrice(agent: Agent): Promise<ScrapeResult> {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey || apiKey.startsWith("exa-...")) {
    return {
      ...FALLBACK,
      product: `${agent.product} ${agent.quantity} ${agent.unit}`,
      matched: FALLBACK.price < agent.trigger.threshold,
    };
  }

  try {
    const exa = new Exa(apiKey);
    const query = `${agent.product} price Singapore SGD buy ${agent.unit}`;

    const search = await exa.search(query, {
      type: "auto",
      numResults: 5,
      includeDomains: ["shopee.sg", "carousell.sg", "lazada.sg", "qoo10.sg"],
      contents: {
        highlights: { query: "price SGD cost", maxCharacters: 2000 },
      },
    });

    const results = search.results ?? [];
    let best: ScrapeResult | null = null;

    for (const result of results) {
      const highlights = (result as { highlights?: string[] }).highlights ?? [];
      const textBlob = [
        result.title ?? "",
        ...highlights,
        (result as { text?: string }).text ?? "",
      ].join(" ");

      const price = parsePriceFromText(textBlob);
      if (price === null) continue;

      const candidate: ScrapeResult = {
        source: "exa",
        supplier: result.title?.slice(0, 80) ?? "Singapore marketplace seller",
        product: agent.product,
        price,
        currency: "SGD",
        url: result.url ?? "",
        matched: price < agent.trigger.threshold,
        highlights: highlights.slice(0, 2),
      };

      if (!result.url || !isListingUrl(result.url)) continue;
      if (!best || price < best.price) best = candidate;
    }

    if (best) return best;

    const topUrl = results[0]?.url;
    if (topUrl) {
      const detail = await exa.getContents([topUrl], {
        highlights: { query: "price SGD", maxCharacters: 1500 },
      });
      const page = detail.results?.[0];
      const highlights = (page as { highlights?: string[] })?.highlights ?? [];
      const text = [page?.title ?? "", ...highlights].join(" ");
      const price = parsePriceFromText(text);
      if (price !== null) {
        return {
          source: "exa",
          supplier: page?.title?.slice(0, 60) ?? "Singapore seller",
          product: agent.product,
          price,
          currency: "SGD",
          url: topUrl,
          matched: price < agent.trigger.threshold,
          highlights: highlights.slice(0, 2),
        };
      }
    }
  } catch {
    // fall through to fallback
  }

  return {
    ...FALLBACK,
    product: `${agent.product} ${agent.quantity} ${agent.unit}`,
    matched: FALLBACK.price < agent.trigger.threshold,
  };
}
