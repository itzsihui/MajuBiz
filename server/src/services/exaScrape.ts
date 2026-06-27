import { Exa } from "exa-js";
import type { Agent, ScrapeResult } from "../types.js";
import { decidePurchase, type BrainDecision, type ListingOption } from "./agentBrain.js";
import { listingRelevanceScore } from "./listingRelevance.js";

export type { BrainDecision };

const FALLBACK: ScrapeResult = {
  source: "fallback",
  supplier: "Demo supplier (Exa not configured)",
  product: "Bubble wrap bulk",
  price: 9.5,
  currency: "SGD",
  url: "",
  matched: true,
  listingPrice: 9.5,
  packQuantity: 50,
  packsNeeded: 1,
  priceDetail: "Demo fallback price",
  highlights: ["Demo data — add EXA_API_KEY to server/.env for live Shopee/Carousell listings"],
};

export interface ScrapeRunResult {
  scrape: ScrapeResult;
  brain: BrainDecision;
}

export type ScrapeProgressFn = (message: string) => void;

function isProductListingUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase();
    const blocked = ["/search", "/list/", "/shop/", "/mall/", "/catalog", "/category", "/browse"];
    if (blocked.some((b) => path.includes(b))) return false;
    if (u.hostname.includes("shopee.sg")) return /-i\.\d+\.\d+/.test(u.pathname);
    if (u.hostname.includes("carousell.sg")) return /\/p\/.+/.test(u.pathname);
    if (u.hostname.includes("lazada.sg")) return /\/products\/.+/.test(u.pathname);
    return false;
  } catch {
    return false;
  }
}

function findProductUrlsInText(text: string): string[] {
  const found = new Set<string>();
  for (const pattern of [
    /https?:\/\/(?:www\.)?shopee\.sg\/[^\s"'<>]+-i\.\d+\.\d+/gi,
    /https?:\/\/(?:www\.)?carousell\.sg\/p\/[^\s"'<>]+/gi,
    /https?:\/\/(?:www\.)?lazada\.sg\/products\/[^\s"'<>]+/gi,
  ]) {
    for (const m of text.matchAll(pattern)) {
      const url = m[0].replace(/[),.;]+$/, "");
      if (isProductListingUrl(url)) found.add(url);
    }
  }
  return [...found];
}

function canonicalListingUrl(url: string): string {
  try {
    const u = new URL(url);
    u.search = "";
    u.hash = "";
    return u.href.replace(/\/$/, "");
  } catch {
    return url.split("?")[0];
  }
}

/** Carousell/Shopee slugs often contain the real product name Exa titles miss */
function titleFromListingUrl(url: string): string | null {
  const carousell = url.match(/carousell\.sg\/p\/([^/?]+)/i);
  if (carousell) {
    return decodeURIComponent(carousell[1].replace(/-/g, " "));
  }
  const shopee = url.match(/shopee\.sg\/([^/?]+)-i\.\d+/i);
  if (shopee) {
    return decodeURIComponent(shopee[1].replace(/-/g, " "));
  }
  return null;
}

function buildSearchQueries(agent: Agent): Array<{ query: string; domains: string[] }> {
  const product = agent.product.trim();
  const promptHint = agent.prompt?.replace(/\bbuy\b.*$/i, "").trim().slice(0, 80) ?? "";
  const terms = product.replace(/\bcustomised\b|\bcustomized\b/gi, "").trim();
  const context = [product, promptHint].filter(Boolean).join(" ");

  return [
    { query: `${context} carousell.sg`, domains: ["carousell.sg"] },
    { query: `${terms} cake customised Singapore carousell`, domains: ["carousell.sg"] },
    { query: `${product} ${agent.quantity} ${agent.unit} price Singapore`, domains: ["shopee.sg", "carousell.sg", "lazada.sg"] },
    { query: `${terms} shopee.sg buy`, domains: ["shopee.sg"] },
  ];
}

function collectListingCandidates(
  results: Array<{ url?: string | null; title?: string | null; text?: string; highlights?: string[] }>,
  agent: Agent
) {
  const seen = new Set<string>();
  const candidates: { url: string; title: string; score: number }[] = [];

  const add = (rawUrl: string, title: string) => {
    const url = canonicalListingUrl(rawUrl);
    if (!isProductListingUrl(url) || seen.has(url)) return;
    seen.add(url);
    const slugTitle = titleFromListingUrl(url);
    const bestTitle = slugTitle && slugTitle.length > 3 ? slugTitle : title;
    const score = listingRelevanceScore(agent, bestTitle, url);
    candidates.push({ url, title: bestTitle, score });
  };

  for (const r of results) {
    if (r.url && isProductListingUrl(r.url)) {
      add(r.url, r.title ?? agent.product);
    }
    const blob = [r.title ?? "", r.text ?? "", ...(r.highlights ?? [])].join(" ");
    for (const url of findProductUrlsInText(blob)) {
      add(url, r.title ?? agent.product);
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

function parsePackFromTitle(title: string): number | null {
  for (const p of [
    /\((\d+)\s*(?:pcs|pc|pieces|rolls|units|pkts|pkt|pack)\)/i,
    /(\d+)\s*(?:pcs|pc|pieces|rolls|units|pkts|pkt|pack)\s*(?:\/|per|\b)/i,
  ]) {
    const m = title.match(p);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

function parsePricesFromText(text: string): number[] {
  const prices: number[] = [];
  for (const m of text.matchAll(/S\$?\s*(\d+(?:\.\d{1,2})?)/gi)) {
    const n = parseFloat(m[1]);
    if (n > 0 && n < 500) prices.push(n);
  }
  return prices;
}

function computeOrderTotal(agent: Agent, listingPrice: number, packQuantity: number) {
  const packsNeeded = Math.max(1, Math.ceil(agent.quantity / packQuantity));
  const total = Math.round(packsNeeded * listingPrice * 100) / 100;
  const priceDetail = `S$${listingPrice.toFixed(2)}/pack (${packQuantity} ${agent.unit}) × ${packsNeeded} pack${packsNeeded > 1 ? "s" : ""} = S$${total.toFixed(2)} for ${agent.quantity} ${agent.unit}`;
  return { total, packsNeeded, priceDetail };
}

async function extractFromListing(exa: Exa, url: string, title: string, agent: Agent) {
  const defaultPackQty = parsePackFromTitle(title) ?? 1;
  try {
    const detail = await exa.getContents([url], {
      highlights: { query: "price SGD per pack", maxCharacters: 1200 },
      summary: {
        query: `Listing price SGD and pack size for: ${title}`,
        schema: {
          type: "object",
          properties: {
            listingPriceSgd: { type: "number" },
            packQuantity: { type: "number" },
          },
          required: ["listingPriceSgd", "packQuantity"],
        },
      },
    });
    const page = detail.results?.[0] as { title?: string; highlights?: string[]; summary?: string };
    let listingPrice: number | null = null;
    let packQuantity = defaultPackQty;
    if (page?.summary) {
      try {
        const p = JSON.parse(page.summary) as { listingPriceSgd?: number; packQuantity?: number };
        if (p.listingPriceSgd && p.listingPriceSgd > 0 && p.listingPriceSgd < 500) listingPrice = p.listingPriceSgd;
        if (p.packQuantity && p.packQuantity > 0) packQuantity = p.packQuantity;
      } catch { /* ignore */ }
    }
    const titleText = page?.title ?? title;
    if (listingPrice === null) {
      const prices = parsePricesFromText(`${titleText} ${(page?.highlights ?? []).join(" ")}`);
      if (prices.length) listingPrice = Math.min(...prices);
    }
    if (listingPrice === null) return null;
    return {
      listingPrice,
      packQuantity,
      supplier: titleText.slice(0, 80),
      url,
      highlights: page?.highlights?.slice(0, 2),
    };
  } catch {
    const prices = parsePricesFromText(title);
    if (!prices.length) return null;
    return {
      listingPrice: Math.min(...prices),
      packQuantity: defaultPackQty,
      supplier: title.slice(0, 80),
      url,
    };
  }
}

function emptyBrain(thoughts: string[], summary: string): BrainDecision {
  return { thoughts, verdicts: [], selectedIndex: null, cheapestAmongRelevant: null, summary };
}

function toScrape(
  agent: Agent,
  option: ListingOption,
  extracted: { highlights?: string[] },
  brain: BrainDecision,
  selected: boolean,
  comparisons: ScrapeResult["priceComparisons"]
): ScrapeResult {
  const verdict = brain.verdicts.find((v) => v.index === option.index);
  return {
    source: "exa",
    supplier: option.title.slice(0, 80),
    product: agent.product,
    price: option.totalPrice,
    currency: "SGD",
    url: option.url,
    matched: selected && option.totalPrice < agent.trigger.threshold,
    relevant: verdict?.relevant ?? false,
    relevanceReason: verdict?.reason ?? brain.summary,
    listingPrice: option.listingPrice,
    packQuantity: option.packQuantity,
    packsNeeded: option.packsNeeded,
    priceDetail: option.priceDetail,
    highlights: extracted.highlights,
    isCheapestPick: selected,
    thoughtProcess: brain.thoughts,
    priceComparisons: comparisons,
  };
}

export async function scrapePrice(agent: Agent, onProgress?: ScrapeProgressFn): Promise<ScrapeRunResult> {
  const progress = (msg: string) => onProgress?.(msg);
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey || apiKey.startsWith("exa-...")) {
    const { total, packsNeeded, priceDetail } = computeOrderTotal(agent, 9.5, 50);
    const brain = emptyBrain([`Demo mode — add EXA_API_KEY`, priceDetail], "Demo fallback");
    return {
      scrape: { ...FALLBACK, product: agent.product, price: total, matched: total < agent.trigger.threshold, packsNeeded, priceDetail, thoughtProcess: brain.thoughts },
      brain,
    };
  }

  try {
    const exa = new Exa(apiKey);
    const queries = buildSearchQueries(agent);

    progress(`Starting Exa search for "${agent.product}"…`);
    for (const q of queries) {
      progress(`Query → ${q.domains.join(", ")}: "${q.query}"`);
    }

    const searchBatches = await Promise.all(
      queries.map((q) =>
        exa.search(q.query, {
          type: "auto",
          numResults: 12,
          includeDomains: q.domains,
          contents: { highlights: { query: `price ${agent.product} SGD`, maxCharacters: 600 } },
        })
      )
    );

    progress(`Exa returned ${searchBatches.reduce((n, s) => n + (s.results?.length ?? 0), 0)} raw hits across ${queries.length} queries`);

    let candidates = collectListingCandidates(
      searchBatches.flatMap((s) => s.results ?? []),
      agent
    );

    progress(`Found ${candidates.length} product listing URL(s) after filtering`);
    for (const c of candidates.slice(0, 3)) {
      progress(`  · [score ${c.score}] ${c.title.slice(0, 55)}…`);
    }

    // Retry: Carousell-only with simplified keywords if nothing scored well
    const topScore = candidates[0]?.score ?? 0;
    if (topScore < 2) {
      progress(`Low relevance scores — retrying Carousell-only search…`);
      const retry = await exa.search(`${agent.product} site:carousell.sg`, {
        type: "auto",
        numResults: 15,
        includeDomains: ["carousell.sg"],
      });
      candidates = collectListingCandidates(
        [...searchBatches.flatMap((s) => s.results ?? []), ...(retry.results ?? [])],
        agent
      );
      progress(`After retry: ${candidates.length} listing URL(s), top score ${candidates[0]?.score ?? 0}`);
    }

    if (!candidates.length) {
      const brain = emptyBrain(
        [
          `Searched Carousell + Shopee for "${agent.product}"`,
          `Exa did not return any product listing URLs — the item may not be indexed yet`,
        ],
        "No listings found"
      );
      return {
        scrape: { source: "exa", supplier: "—", product: agent.product, price: 0, currency: "SGD", url: "", matched: false, thoughtProcess: brain.thoughts, relevanceReason: brain.summary },
        brain,
      };
    }

    const options: ListingOption[] = [];
    const extractedMap = new Map<number, { highlights?: string[] }>();
    const toPriceCheck = candidates.slice(0, 8);

    progress(`Fetching prices from top ${toPriceCheck.length} listing(s)…`);

    for (const { url, title } of toPriceCheck) {
      progress(`  Reading ${new URL(url).hostname}${new URL(url).pathname.slice(0, 40)}…`);
      const extracted = await extractFromListing(exa, url, title, agent);
      if (!extracted) {
        progress(`    ✗ Could not extract price`);
        continue;
      }
      progress(`    ✓ S$${extracted.listingPrice.toFixed(2)} — ${extracted.supplier.slice(0, 45)}`);
      const { total, packsNeeded, priceDetail } = computeOrderTotal(agent, extracted.listingPrice, extracted.packQuantity);
      const idx = options.length;
      options.push({
        index: idx,
        title: extracted.supplier,
        url: extracted.url,
        totalPrice: total,
        priceDetail,
        listingPrice: extracted.listingPrice,
        packQuantity: extracted.packQuantity,
        packsNeeded,
      });
      extractedMap.set(idx, extracted);
    }

    if (options.length === 0) {
      progress(`No prices extracted — listings may be unindexed or missing SGD on page`);
      const brain = emptyBrain(
        [
          `Found ${candidates.length} listing URL(s) on Exa but could not read prices from any page`,
          ...candidates.slice(0, 4).map((c) => `  · ${c.title.slice(0, 50)} — ${c.url}`),
        ],
        "Could not read listing prices"
      );
      return {
        scrape: {
          source: "exa",
          supplier: "—",
          product: agent.product,
          price: 0,
          currency: "SGD",
          url: candidates[0]?.url ?? "",
          matched: false,
          thoughtProcess: brain.thoughts,
          relevanceReason: brain.summary,
        },
        brain,
      };
    }

    progress(`Agent Brain reviewing ${options.length} priced listing(s)…`);
    const brain = await decidePurchase(agent, options, candidates.length);

    const comparisons = options.map((o) => ({
      title: o.title.slice(0, 60),
      total: o.totalPrice,
      relevant: brain.verdicts.find((v) => v.index === o.index)?.relevant ?? false,
      url: o.url,
      selected: brain.selectedIndex === o.index,
    }));

    if (brain.selectedIndex !== null) {
      const option = options.find((o) => o.index === brain.selectedIndex)!;
      return {
        scrape: toScrape(agent, option, extractedMap.get(option.index)!, brain, true, comparisons),
        brain,
      };
    }

    const fallback = options[0]!;
    return {
      scrape: toScrape(agent, fallback, extractedMap.get(fallback.index)!, brain, false, comparisons),
      brain,
    };
  } catch (err) {
    const brain = emptyBrain([`Search error: ${err instanceof Error ? err.message : "failed"}`], "Search failed");
    return {
      scrape: { source: "exa", supplier: "—", product: agent.product, price: 0, currency: "SGD", url: "", matched: false, thoughtProcess: brain.thoughts },
      brain,
    };
  }
}

export function formatScrapeMessage(scrape: ScrapeResult): string {
  if (scrape.isCheapestPick && scrape.priceDetail) {
    return `Cheapest match: ${scrape.priceDetail} — ${scrape.supplier}`;
  }
  return scrape.relevanceReason ?? scrape.priceDetail ?? "No purchase";
}
