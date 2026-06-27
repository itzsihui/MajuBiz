import { Exa } from "exa-js";
import type { Agent, ScrapeResult } from "../types.js";
import { decidePurchase, type BrainDecision, type ListingOption } from "./agentBrain.js";
import { listingRelevanceScore, isLikelyWrongSubtype, matchesProductKeywords } from "./listingRelevance.js";
import { marketplaceSearchUrl } from "./marketplaceSearch.js";
import { searchSellerAgentFallback } from "./sellerAgentFallback.js";

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
    /=\s*(\d+)\s*pcs?\b/i,
    /(\d+)\s*rolls?\b/i,
    /\((\d+)\s*(?:pcs|pc|pieces|rolls|units|pkts|pkt|pack|boxes)\)/i,
    /(\d+)\s*(?:pcs|pc|pieces|rolls|units|pkts|pkt|pack|boxes)\s*(?:\/|per|\b)/i,
  ]) {
    const m = title.match(p);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

function parsePricesFromText(text: string): number[] {
  const prices: number[] = [];
  const lower = text.toLowerCase();
  for (const m of text.matchAll(/(?:^|[^\d])S\$?\s*(\d+(?:\.\d{1,2})?)\b/gi)) {
    const idx = m.index ?? 0;
    const before = lower.slice(Math.max(0, idx - 24), idx);
    if (/\b(save|off|discount|qty|quantity|min\.?\s*order|per\s*)\s*$/i.test(before)) continue;
    const n = parseFloat(m[1]);
    if (n >= 0.5 && n <= MAX_LISTING_PRICE_SGD) prices.push(n);
  }
  return prices;
}

/** Prefer median listing price — avoids "Save S$5" / qty numbers picked as the main price */
function pickListingPrice(prices: number[]): number | null {
  if (!prices.length) return null;
  const sorted = [...new Set(prices)].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];

  const median = sorted[Math.floor(sorted.length / 2)];
  const filtered = sorted.filter((p) => p >= median * 0.55);
  const pool = filtered.length ? filtered : sorted;
  return pool[Math.floor(pool.length / 2)];
}

function resolveListingPrice(summaryPrice: number | null, pageText: string): number | null {
  const fromText = pickListingPrice(parsePricesFromText(pageText));
  if (summaryPrice === null) return fromText;
  if (fromText === null) return summaryPrice;
  if (summaryPrice < fromText * 0.65) return fromText;
  if (fromText > summaryPrice * 1.4) return fromText;
  return summaryPrice;
}

const MAX_LISTING_PRICE_SGD = 250;

function sanitizeTextForPriceParsing(text: string, url: string): string {
  let clean = text;
  try {
    const u = new URL(url);
    clean += ` ${u.pathname}`;
  } catch { /* ignore */ }
  return clean
    .replace(/-i\.\d+\.\d+/gi, " ")
    .replace(/\/products\/[^?\s]+/gi, " ")
    .replace(/\bi\d{7,}\b/gi, " ")
    .replace(/\b\d{8,}\b/g, " ")
    .replace(/\b\d{5,}\.\d+\b/g, " ");
}

function maxPlausiblePackPrice(agent: Agent): number {
  return Math.max(agent.trigger.threshold * 1.5, 25);
}

function isPricePlausible(agent: Agent, listingPrice: number, packQuantity: number): boolean {
  if (listingPrice < 0.5 || listingPrice > MAX_LISTING_PRICE_SGD) return false;
  if (listingPrice > maxPlausiblePackPrice(agent)) return false;

  const packsNeeded = Math.max(1, Math.ceil(agent.quantity / Math.max(1, packQuantity)));
  const orderTotal = packsNeeded * listingPrice;
  if (orderTotal > agent.trigger.threshold * 2.5) return false;

  const perUnit = listingPrice / Math.max(1, packQuantity);
  const p = agent.product.toLowerCase();
  if (p.includes("box") || p.includes("carton")) return perUnit >= 0.35 && perUnit <= 8;
  if (p.includes("wrap") || p.includes("tape")) return perUnit >= 0.02 && perUnit <= 3;
  if (p.includes("cake")) return listingPrice >= 15 && listingPrice <= 120;
  return true;
}

function clampSummaryPrice(raw: number, agent: Agent): number | null {
  if (!Number.isFinite(raw) || raw < 0.5 || raw > MAX_LISTING_PRICE_SGD) return null;
  if (raw > maxPlausiblePackPrice(agent)) return null;
  return raw;
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
        query: `What is the current main selling price in SGD for this product listing: ${title}? Return the price for ONE pack/SKU as shown on the page (e.g. "10 pcs" pack price). Do NOT use quantity counts, "save $X" promos, shipping, or per-piece math — only the headline listing price in SGD.`,
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
    let summaryPrice: number | null = null;
    if (page?.summary) {
      try {
        const p = JSON.parse(page.summary) as {
          listingPriceSgd?: number;
          packQuantity?: number;
          productName?: string;
        };
        if (p.listingPriceSgd) summaryPrice = clampSummaryPrice(p.listingPriceSgd, agent);
        if (p.packQuantity && p.packQuantity > 0 && p.packQuantity <= agent.quantity * 2) {
          packQuantity = Math.round(p.packQuantity);
        }
        if (p.productName) supplier = p.productName.slice(0, 80);
      } catch { /* ignore */ }
    }
    const pageText = sanitizeTextForPriceParsing(
      `${page?.title ?? title} ${(page?.highlights ?? []).join(" ")}`,
      url
    );
    listingPrice = resolveListingPrice(summaryPrice, pageText);
    if (listingPrice === null) return null;
    if (!isPricePlausible(agent, listingPrice, packQuantity)) return null;
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
    if (!listingPrice || !isPricePlausible(agent, listingPrice, defaultPackQty)) return null;
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
  candidates: Array<{ url: string; title: string; listingPrice?: number; packQuantity?: number; source?: ScrapeResult["source"]; sellerName?: string; sellerId?: string }>,
  progress: (msg: string) => void,
  limit = 12,
  label = "Exa"
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

  let skipped = 0;

  for (const { url, title, listingPrice, packQuantity, source, sellerName, sellerId } of candidates.slice(0, limit)) {
    const isSeller = source === "seller-agent";
    const extracted = await extractFromListing(exa, url, title, agent, { listingPrice, packQuantity });
    if (!extracted) {
      if (!isSeller) skipped++;
      continue;
    }

    const { total, packsNeeded, priceDetail } = computeOrderTotal(agent, extracted.listingPrice, extracted.packQuantity);
    if (total > agent.trigger.threshold * 2.5) {
      if (!isSeller) skipped++;
      continue;
    }
    if (isSeller) {
      progress(`  ✓ Seller Agent: S$${total.toFixed(2)} — ${title.slice(0, 45)}`);
    } else {
      progress(`  ✓ Live via Exa: S$${total.toFixed(2)} — ${extracted.supplier.slice(0, 45)}`);
    }

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
      source: isSeller ? "seller-agent" : source ?? "exa",
      sellerName,
      sellerAgentId: sellerId,
    });
  }

  if (skipped > 0 && label === "Exa") {
    progress(`  (${skipped} listing(s) skipped — no price on page)`);
  }

  return { options, extractedMap };
}

async function mergeSellerAgentOptions(
  exa: Exa,
  agent: Agent,
  options: ListingOption[],
  extractedMap: Map<number, { highlights?: string[]; imageUrl?: string; source?: ScrapeResult["source"]; sellerName?: string; sellerAgentId?: string }>,
  progress: (msg: string) => void,
  exaPriceFloor: number
) {
  const sellerHits = searchSellerAgentFallback(agent, progress, { exaPriceFloor, quiet: true });
  progress(`Seller Agent — comparing structured quotes alongside Exa…`);
  const seen = new Set(options.map((o) => o.url));
  const fresh = sellerHits.filter((h) => !seen.has(h.url));
  if (!fresh.length) return;

  const extra = await buildOptionsFromCandidates(exa, agent, fresh, progress, 6, "Seller Agent");
  for (const o of extra.options) {
    const newIdx = options.length;
    extractedMap.set(newIdx, extra.extractedMap.get(o.index)!);
    options.push({ ...o, index: newIdx });
  }
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

    progress(`Exa — searching "${agent.product}" on Shopee, Carousell, Lazada…`);

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

    const rawHits = searchBatches.reduce((n, s) => n + (s.results?.length ?? 0), 0);
    let candidates = collectListingCandidates(
      searchBatches.flatMap((s) => s.results ?? []),
      agent
    );

    progress(`Exa — ${candidates.length} listing(s) found (${rawHits} raw hits)`);
    for (const c of candidates.slice(0, 3)) {
      progress(`  · ${c.title.slice(0, 55)}…`);
    }

    const topScore = candidates[0]?.score ?? 0;
    if (topScore < 2) {
      const retry = await exa.search(`${agent.product} site:carousell.sg`, {
        type: "auto",
        numResults: 15,
        includeDomains: ["carousell.sg"],
      });
      candidates = collectListingCandidates(
        [...searchBatches.flatMap((s) => s.results ?? []), ...(retry.results ?? [])],
        agent
      );
      if (candidates.length) {
        progress(`Exa — ${candidates.length} listing(s) after Carousell retry`);
      }
    }

    const exaOnlyCandidates = [...candidates];

    let { options, extractedMap } = exaOnlyCandidates.length
      ? await (async () => {
          progress(`Exa — reading prices…`);
          return buildOptionsFromCandidates(exa, agent, exaOnlyCandidates, progress, 8);
        })()
      : { options: [] as ListingOption[], extractedMap: new Map() };

    if (options.length === 0) {
      if (!exaOnlyCandidates.length) {
        progress(`Exa — no listings found, trying Seller Agent…`);
      } else {
        progress(`Exa — could not read prices, trying Seller Agent…`);
      }
      const sellerHits = searchSellerAgentFallback(agent, progress);
      if (sellerHits.length) {
        ({ options, extractedMap } = await buildOptionsFromCandidates(exa, agent, sellerHits, progress, 6, "Seller Agent"));
      }
    } else {
      const minExaTotal = Math.min(...options.map((o) => o.totalPrice));
      if (minExaTotal <= agent.trigger.threshold * 2) {
        await mergeSellerAgentOptions(exa, agent, options, extractedMap, progress, minExaTotal);
      }
    }

    if (options.length === 0) {
      const brain = emptyBrain([`Could not price listings for "${agent.product}"`], "Could not read listing prices");
      return {
        scrape: {
          source: "exa",
          supplier: "—",
          product: agent.product,
          price: 0,
          currency: "SGD",
          url: exaOnlyCandidates[0]?.url ?? marketplaceSearchUrl(agent),
          matched: false,
          thoughtProcess: brain.thoughts,
          relevanceReason: brain.summary,
        },
        brain,
      };
    }

    progress(`Agent Brain reviewing ${options.length} priced listing(s)…`);
    let brain = await decidePurchase(agent, options, exaOnlyCandidates.length);

    if (!hasRelevantSelection(brain)) {
      progress(`Seller Agent — adding structured quotes…`);
      const sellerHits = searchSellerAgentFallback(agent, progress);
      const seenUrls = new Set(options.map((o) => o.url));
      const fresh = sellerHits.filter((d) => !seenUrls.has(d.url));
      if (fresh.length) {
        const extra = await buildOptionsFromCandidates(exa, agent, fresh, progress, 6, "Seller Agent");
        for (const o of extra.options) {
          const newIdx = options.length;
          extractedMap.set(newIdx, extra.extractedMap.get(o.index)!);
          options.push({ ...o, index: newIdx });
        }
        progress(`Agent Brain re-reviewing ${options.length} listing(s)…`);
        brain = await decidePurchase(agent, options, exaOnlyCandidates.length + fresh.length);
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
