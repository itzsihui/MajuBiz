import { Exa } from "exa-js";
import type { Agent, ScrapeResult } from "../types.js";
import { decidePurchase, type BrainDecision, type ListingOption } from "./agentBrain.js";
import { listingRelevanceScore, isLikelyWrongSubtype, matchesProductKeywords } from "./listingRelevance.js";
import { marketplaceSearchUrl, searchMarketplaceDirect } from "./marketplaceSearch.js";

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
    if (u.hostname.includes("lazada.sg")) {
      if (path.includes("punish") || path.includes("_____tmd_____")) return false;
      return /\/products\/.+/.test(u.pathname);
    }
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
  const context = `${agent.product} ${agent.prompt ?? ""}`;

  const queries: Array<{ query: string; domains: string[] }> = [
    { query: `${product} shopee.sg`, domains: ["shopee.sg"] },
    { query: `${product} packaging Singapore`, domains: ["shopee.sg", "lazada.sg"] },
    { query: `${product} ${agent.quantity} ${agent.unit}`, domains: ["shopee.sg", "carousell.sg", "lazada.sg"] },
    { query: `${product} wholesale bulk`, domains: ["shopee.sg", "lazada.sg"] },
  ];

  if (/\bcake\b/i.test(context)) {
    queries.push({
      query: `${product.replace(/\bcustomised\b|\bcustomized\b/gi, "").trim()} customised cake carousell`,
      domains: ["carousell.sg"],
    });
  }

  return queries;
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
    const slugTitle = titleFromListingUrl(url);
    const bestTitle = slugTitle && slugTitle.length > 3 ? slugTitle : title;
    if (!matchesProductKeywords(agent, bestTitle, url)) return;
    seen.add(url);
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
    /(\d+)\s*rolls?\b/i,
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
  for (const m of text.matchAll(/(?:^|[^\d])S\$?\s*(\d+(?:\.\d{1,2})?)\b/gi)) {
    const n = parseFloat(m[1]);
    if (n >= 0.5 && n < 500) prices.push(n);
  }
  return prices;
}

/** Avoid grabbing promo noise like "Save S$1" — prefer median cluster */
function pickListingPrice(prices: number[]): number | null {
  if (!prices.length) return null;
  const sorted = [...new Set(prices)].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];

  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  if (max > min * 2.5) {
    const mid = sorted[Math.floor(sorted.length / 2)];
    const cluster = sorted.filter((p) => p >= mid * 0.65);
    return cluster[0] ?? mid;
  }
  return sorted[0];
}

function computeOrderTotal(agent: Agent, listingPrice: number, packQuantity: number) {
  const packsNeeded = Math.max(1, Math.ceil(agent.quantity / packQuantity));
  const total = Math.round(packsNeeded * listingPrice * 100) / 100;
  const priceDetail = `S$${listingPrice.toFixed(2)}/pack (${packQuantity} ${agent.unit}) × ${packsNeeded} pack${packsNeeded > 1 ? "s" : ""} = S$${total.toFixed(2)} for ${agent.quantity} ${agent.unit}`;
  return { total, packsNeeded, priceDetail };
}

async function extractFromListing(
  exa: Exa,
  url: string,
  title: string,
  agent: Agent,
  preset?: { listingPrice?: number; packQuantity?: number }
) {
  const defaultPackQty = preset?.packQuantity ?? parsePackFromTitle(title) ?? 1;
  if (preset?.listingPrice && preset.listingPrice > 0) {
    return {
      listingPrice: preset.listingPrice,
      packQuantity: defaultPackQty,
      supplier: title.slice(0, 80),
      url,
    };
  }
  try {
    const detail = await exa.getContents([url], {
      highlights: { query: "price SGD listing price", maxCharacters: 1200 },
      summary: {
        query: `What is the main listing price in SGD for buying: ${title}? Ignore shipping vouchers or "save $X" promos. Include pack size if shown.`,
        schema: {
          type: "object",
          properties: {
            listingPriceSgd: { type: "number" },
            packQuantity: { type: "number" },
            productName: { type: "string" },
          },
          required: ["listingPriceSgd", "packQuantity", "productName"],
        },
      },
    });
    const page = detail.results?.[0] as {
      title?: string;
      highlights?: string[];
      summary?: string;
      image?: string;
    };
    let listingPrice: number | null = null;
    let packQuantity = defaultPackQty;
    let supplier = title;
    if (page?.summary) {
      try {
        const p = JSON.parse(page.summary) as {
          listingPriceSgd?: number;
          packQuantity?: number;
          productName?: string;
        };
        if (p.listingPriceSgd && p.listingPriceSgd >= 0.5 && p.listingPriceSgd < 500) {
          listingPrice = p.listingPriceSgd;
        }
        if (p.packQuantity && p.packQuantity > 0) packQuantity = p.packQuantity;
        if (p.productName) supplier = p.productName.slice(0, 80);
      } catch { /* ignore */ }
    }
    const titleText = page?.title ?? title;
    if (listingPrice === null) {
      const prices = parsePricesFromText(`${titleText} ${(page?.highlights ?? []).join(" ")}`);
      listingPrice = pickListingPrice(prices);
    }
    if (listingPrice === null) return null;
    if (isLikelyWrongSubtype(agent, supplier, url)) return null;

    return {
      listingPrice,
      packQuantity,
      supplier: supplier.slice(0, 80),
      url,
      highlights: page?.highlights?.slice(0, 2),
      imageUrl: page?.image,
    };
  } catch {
    const prices = parsePricesFromText(title);
    const listingPrice = pickListingPrice(prices);
    if (!listingPrice) return null;
    if (isLikelyWrongSubtype(agent, title, url)) return null;
    return {
      listingPrice,
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
  extracted: {
    highlights?: string[];
    imageUrl?: string;
    source?: ScrapeResult["source"];
    sellerName?: string;
    sellerAgentId?: string;
  },
  brain: BrainDecision,
  selected: boolean,
  comparisons: ScrapeResult["priceComparisons"]
): ScrapeResult {
  const verdict = brain.verdicts.find((v) => v.index === option.index);
  return {
    source: extracted.source ?? "exa",
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
    imageUrl: extracted.imageUrl,
    isCheapestPick: selected,
    thoughtProcess: brain.thoughts,
    priceComparisons: comparisons,
    sellerName: extracted.sellerName,
    sellerAgentId: extracted.sellerAgentId,
  };
}

function hasRelevantSelection(brain: BrainDecision): boolean {
  return brain.selectedIndex !== null || brain.verdicts.some((v) => v.relevant);
}

async function buildOptionsFromCandidates(
  exa: Exa,
  agent: Agent,
  candidates: Array<{ url: string; title: string; listingPrice?: number; packQuantity?: number }>,
  progress: (msg: string) => void,
  limit = 12
) {
  const options: ListingOption[] = [];
  const extractedMap = new Map<
    number,
    {
      highlights?: string[];
      imageUrl?: string;
      source?: ScrapeResult["source"];
      sellerName?: string;
      sellerAgentId?: string;
    }
  >();

  progress(`Fetching prices from top ${Math.min(limit, candidates.length)} listing(s)…`);

  for (const { url, title, listingPrice, packQuantity, source, sellerName, sellerId } of candidates.slice(0, limit) as Array<{
    url: string;
    title: string;
    listingPrice?: number;
    packQuantity?: number;
    source?: ScrapeResult["source"];
    sellerName?: string;
    sellerId?: string;
  }>) {
    if (source === "seller-agent" && listingPrice) {
      progress(`  ✓ ${sellerName ?? "Seller Agent"}: S$${listingPrice.toFixed(2)} — ${title.slice(0, 45)}`);
    } else if (source === "shopee-open" && listingPrice) {
      progress(`  ✓ Shopee Open Platform: S$${listingPrice.toFixed(2)} — ${title.slice(0, 45)}`);
    } else {
      progress(`  Reading ${new URL(url).hostname}${new URL(url).pathname.slice(0, 40)}…`);
    }
    const extracted = await extractFromListing(exa, url, title, agent, { listingPrice, packQuantity });
    if (!extracted) {
      progress(`    ✗ Could not extract price`);
      continue;
    }
    if (source !== "seller-agent" && source !== "shopee-open") {
      progress(`    ✓ S$${extracted.listingPrice.toFixed(2)} — ${extracted.supplier.slice(0, 45)}`);
    }
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
    extractedMap.set(idx, {
      highlights: extracted.highlights,
      imageUrl: extracted.imageUrl,
      source: source ?? "exa",
      sellerName,
      sellerAgentId: sellerId,
    });
  }

  return { options, extractedMap };
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
      progress(`Exa found no listing URLs — switching to direct marketplace search…`);
    }

    let allCandidates = [...candidates];

    if (!allCandidates.length || (allCandidates[0]?.score ?? 0) < 4) {
      const direct = await searchMarketplaceDirect(agent, progress);
      const seen = new Set(allCandidates.map((c) => c.url));
      for (const d of direct) {
        if (!seen.has(d.url)) {
          allCandidates.push({
            url: d.url,
            title: d.title,
            score: d.score,
            listingPrice: d.listingPrice,
            packQuantity: d.packQuantity,
            source: d.source,
            sellerName: d.sellerName,
            sellerId: d.sellerId,
          } as (typeof allCandidates[0] & {
            listingPrice?: number;
            packQuantity?: number;
            source?: ScrapeResult["source"];
            sellerName?: string;
            sellerId?: string;
          }));
          seen.add(d.url);
        }
      }
      allCandidates.sort((a, b) => b.score - a.score);
      progress(`Combined pool: ${allCandidates.length} listing(s)`);
    }

    if (!allCandidates.length) {
      const brain = emptyBrain(
        [
          `Exa and direct search found no listings for "${agent.product}"`,
          `Try manually: ${marketplaceSearchUrl(agent)}`,
        ],
        "No listings found"
      );
      return {
        scrape: { source: "exa", supplier: "—", product: agent.product, price: 0, currency: "SGD", url: marketplaceSearchUrl(agent), matched: false, thoughtProcess: brain.thoughts, relevanceReason: brain.summary },
        brain,
      };
    }

    let { options, extractedMap } = await buildOptionsFromCandidates(
      exa,
      agent,
      allCandidates,
      progress
    );

    if (options.length === 0) {
      progress(`No prices from Exa pool — retrying with direct marketplace search…`);
      const direct = await searchMarketplaceDirect(agent, progress);
      if (direct.length) {
        ({ options, extractedMap } = await buildOptionsFromCandidates(exa, agent, direct, progress));
      }
    }

    if (options.length === 0) {
      progress(`No prices extracted — listings may be unindexed or missing SGD on page`);
      const brain = emptyBrain(
        [
          `Found ${allCandidates.length} listing URL(s) but could not read prices`,
          `Manual Shopee search: ${marketplaceSearchUrl(agent)}`,
          ...allCandidates.slice(0, 4).map((c) => `  · ${c.title.slice(0, 50)} — ${c.url}`),
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
          url: allCandidates[0]?.url ?? marketplaceSearchUrl(agent),
          matched: false,
          thoughtProcess: brain.thoughts,
          relevanceReason: brain.summary,
        },
        brain,
      };
    }

    progress(`Agent Brain reviewing ${options.length} priced listing(s)…`);
    let brain = await decidePurchase(agent, options, allCandidates.length);

    if (!hasRelevantSelection(brain)) {
      progress(`Exa results not relevant — running direct marketplace search…`);
      const direct = await searchMarketplaceDirect(agent, progress);
      const seenUrls = new Set(options.map((o) => o.url));
      const fresh = direct.filter((d) => !seenUrls.has(d.url));
      if (fresh.length) {
        const extra = await buildOptionsFromCandidates(exa, agent, fresh, progress, 10);
        for (const o of extra.options) {
          const newIdx = options.length;
          extractedMap.set(newIdx, extra.extractedMap.get(o.index)!);
          options.push({ ...o, index: newIdx });
        }
        progress(`Agent Brain re-reviewing ${options.length} listing(s) after direct search…`);
        brain = await decidePurchase(agent, options, allCandidates.length + fresh.length);
      }
    }

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
