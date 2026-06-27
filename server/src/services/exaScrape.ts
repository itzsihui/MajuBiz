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
  const lazada = url.match(/lazada\.sg\/products\/([^/?]+)/i);
  if (lazada) {
    return decodeURIComponent(lazada[1].replace(/-/g, " "));
  }
  return null;
}

function buildSearchQueries(agent: Agent): Array<{ query: string; domains: string[] }> {
  const product = agent.product.trim();
  const context = `${agent.product} ${agent.prompt ?? ""}`;

  const queries: Array<{ query: string; domains: string[] }> = [
    { query: `${product} shopee.sg`, domains: ["shopee.sg"] },
    { query: `${product} site:lazada.sg`, domains: ["lazada.sg"] },
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
  const snippetByUrl = new Map<string, string>();
  const candidates: { url: string; title: string; score: number; searchSnippet?: string }[] = [];

  const mergeSnippet = (url: string, snippet: string) => {
    const prev = snippetByUrl.get(url) ?? "";
    snippetByUrl.set(url, `${prev} ${snippet}`.trim().slice(0, 4000));
  };

  const add = (rawUrl: string, title: string, snippet?: string) => {
    const url = canonicalListingUrl(rawUrl);
    if (!isProductListingUrl(url)) return;
    if (snippet) mergeSnippet(url, snippet);

    if (seen.has(url)) {
      const existing = candidates.find((c) => c.url === url);
      if (existing) existing.searchSnippet = snippetByUrl.get(url);
      return;
    }

    const slugTitle = titleFromListingUrl(url);
    const bestTitle = slugTitle && slugTitle.length > 3 ? slugTitle : title;
    if (!matchesProductKeywords(agent, bestTitle, url)) return;
    seen.add(url);
    const score = listingRelevanceScore(agent, bestTitle, url);
    candidates.push({ url, title: bestTitle, score, searchSnippet: snippetByUrl.get(url) });
  };

  for (const r of results) {
    const snippet = [r.title ?? "", r.text ?? "", ...(r.highlights ?? [])].join(" ");
    if (r.url && isProductListingUrl(r.url)) {
      add(r.url, r.title ?? agent.product, snippet);
    }
    for (const url of findProductUrlsInText(snippet)) {
      add(url, r.title ?? agent.product, snippet);
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

function parsePackFromTitle(title: string): number | null {
  for (const p of [
    /=\s*(\d+)\s*pcs?\b/i,
    /(\d+)\s*rolls?\b/i,
    /\((\d+)\s*(?:pcs|pc|pieces|rolls|units|pkts|pkt|pack|boxes|box)\)/i,
    /(\d+)\s*(?:pcs|pc|pieces|rolls|units|pkts|pkt|pack|boxes|box)\s*(?:\/|per|\b)/i,
    /pack\s*of\s*(\d+)/i,
    /(\d+)\s*\/\s*pack/i,
    /(\d+)\s*box(?:es)?\b/i,
    /(\d+)\s*cartons?\b/i,
  ]) {
    const m = title.match(p);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

function isCarousellListing(url: string): boolean {
  return /carousell\.sg\/p\//i.test(url);
}

function inferPackQuantity(agent: Agent, title: string, listingPrice: number, parsedFromTitle: number | null, url?: string): number {
  if (parsedFromTitle && parsedFromTitle > 0) return parsedFromTitle;
  // Carousell listings are priced per single item (e.g. S$4/box)
  if (url && isCarousellListing(url) && listingPrice > 0 && listingPrice <= 50) return 1;

  const p = agent.product.toLowerCase();
  if (!(p.includes("box") || p.includes("carton"))) return 1;

  const candidates = [agent.quantity, 100, 50, 25, 20, 10, 5];
  for (const qty of candidates) {
    const perUnit = listingPrice / qty;
    if (perUnit >= 0.12 && perUnit <= 8 && listingPrice <= maxPlausiblePackPrice(agent)) {
      return qty;
    }
  }
  return 1;
}

function parsePricesFromText(text: string): number[] {
  const prices: number[] = [];
  const lower = text.toLowerCase();
  const patterns = [
    /(?:^|[^\d])S\$?\s*(\d+(?:\.\d{1,2})?)\b/gi,
    /(?:^|[^\d])SGD\s*(\d+(?:\.\d{1,2})?)\b/gi,
    /(?:^|[^\d])\$\s*(\d+(?:\.\d{1,2})?)\b/g,
    /(?:price|now|sale|only)[:\s]*S?\$?\s*(\d+(?:\.\d{1,2})?)/gi,
  ];
  for (const pattern of patterns) {
    for (const m of text.matchAll(pattern)) {
      const idx = m.index ?? 0;
      const before = lower.slice(Math.max(0, idx - 24), idx);
      if (/\b(save|off|discount|qty|quantity|min\.?\s*order|per\s*)\s*$/i.test(before)) continue;
      const n = parseFloat(m[1]);
      if (n >= 0.5 && n <= MAX_LISTING_PRICE_SGD) prices.push(n);
    }
  }
  return prices;
}

function maxUnitBudget(agent: Agent): number {
  return agent.trigger.threshold / Math.max(1, agent.quantity);
}

function filterPricesForAgent(prices: number[], agent: Agent, url?: string): number[] {
  const p = agent.product.toLowerCase();
  const maxUnit = maxUnitBudget(agent);
  let cap = MAX_LISTING_PRICE_SGD;

  if (p.includes("box") || p.includes("carton")) {
    cap = Math.min(cap, Math.max(15, maxUnit * 4));
    if (url && isCarousellListing(url)) cap = Math.min(cap, Math.max(12, maxUnit * 2.5));
  } else if (p.includes("wrap") || p.includes("tape")) {
    cap = Math.min(cap, Math.max(8, maxUnit * 20));
  }

  return prices.filter((price) => price <= cap);
}

/** Prefer median listing price — Carousell uses cheapest listed variant (S$4 not S$4.50) */
function pickListingPrice(prices: number[], agent: Agent, url?: string): number | null {
  const filtered = filterPricesForAgent(prices, agent, url);
  if (!filtered.length) return null;
  const sorted = [...new Set(filtered)].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  if (url && isCarousellListing(url)) return sorted[0];

  const median = sorted[Math.floor(sorted.length / 2)];
  const pool = sorted.filter((p) => p >= median * 0.55);
  return (pool.length ? pool : sorted)[Math.floor((pool.length ? pool : sorted).length / 2)];
}

function resolveListingPrice(summaryPrice: number | null, pageText: string, agent: Agent, url?: string): number | null {
  const fromText = pickListingPrice(parsePricesFromText(pageText), agent, url);
  if (summaryPrice === null) return fromText;
  if (fromText === null) return clampSummaryPrice(summaryPrice, agent);
  const summary = clampSummaryPrice(summaryPrice, agent);
  if (summary === null) return fromText;
  if (summary < fromText * 0.65) return fromText;
  if (fromText > summary * 1.4) return fromText;
  return summary;
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
  if (orderTotal > agent.trigger.threshold * 1.05) return false;

  const perUnit = listingPrice / Math.max(1, packQuantity);
  const budgetPerUnit = maxUnitBudget(agent);
  if (perUnit > budgetPerUnit * 1.05) return false;

  const p = agent.product.toLowerCase();
  if (p.includes("box") || p.includes("carton")) return perUnit >= 0.12 && perUnit <= Math.min(8, budgetPerUnit * 1.05);
  if (p.includes("wrap") || p.includes("tape")) return perUnit >= 0.02 && perUnit <= Math.min(3, budgetPerUnit * 1.05);
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

function extractPriceFromSearchSnippet(
  agent: Agent,
  url: string,
  title: string,
  searchSnippet: string,
  defaultPackQty: number
): { listingPrice: number; packQuantity: number; supplier: string } | null {
  const parsedPack = parsePackFromTitle(title);
  const pageText = sanitizeTextForPriceParsing(`${title} ${searchSnippet}`, url);
  const listingPrice = resolveListingPrice(null, pageText, agent, url);
  if (listingPrice === null) return null;

  const packQuantity =
    defaultPackQty > 1
      ? defaultPackQty
      : inferPackQuantity(agent, title, listingPrice, parsedPack, url);
  if (!isPricePlausible(agent, listingPrice, packQuantity)) return null;
  if (isLikelyWrongSubtype(agent, title, url)) return null;

  return { listingPrice, packQuantity, supplier: title.slice(0, 80) };
}

async function extractFromListing(
  exa: Exa,
  url: string,
  title: string,
  agent: Agent,
  preset?: { listingPrice?: number; packQuantity?: number; searchSnippet?: string }
): Promise<{
  listingPrice: number;
  packQuantity: number;
  supplier: string;
  url: string;
  highlights?: string[];
  imageUrl?: string;
  priceSource?: "search-snippet" | "page";
} | null> {
  const parsedPack = parsePackFromTitle(title);
  const defaultPackQty = preset?.packQuantity ?? parsedPack ?? 1;
  if (preset?.listingPrice && preset.listingPrice > 0) {
    return {
      listingPrice: preset.listingPrice,
      packQuantity: defaultPackQty,
      supplier: title.slice(0, 80),
      url,
    };
  }

  // Search highlights already include prices — use them directly, skip full page fetch
  if (preset?.searchSnippet?.trim()) {
    const fromSnippet = extractPriceFromSearchSnippet(
      agent,
      url,
      title,
      preset.searchSnippet,
      defaultPackQty
    );
    if (fromSnippet) {
      return { ...fromSnippet, url, priceSource: "search-snippet" };
    }
  }

  // Fallback: fetch listing page only when search snippet had no usable price
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
      `${page?.title ?? title} ${(page?.highlights ?? []).join(" ")} ${preset?.searchSnippet ?? ""}`,
      url
    );
    const listingPrice = resolveListingPrice(summaryPrice, pageText, agent, url);
    if (listingPrice === null) return null;
    if (packQuantity === 1 && !parsedPack) {
      packQuantity = inferPackQuantity(agent, `${title} ${supplier}`, listingPrice, parsedPack, url);
    }
    if (!isPricePlausible(agent, listingPrice, packQuantity)) return null;
    if (isLikelyWrongSubtype(agent, supplier, url)) return null;

    return {
      listingPrice,
      packQuantity,
      supplier: supplier.slice(0, 80),
      url,
      highlights: page?.highlights?.slice(0, 2),
      imageUrl: page?.image,
      priceSource: "page",
    };
  } catch {
    return null;
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
  candidates: Array<{
    url: string;
    title: string;
    listingPrice?: number;
    packQuantity?: number;
    source?: ScrapeResult["source"];
    sellerName?: string;
    sellerId?: string;
    searchSnippet?: string;
  }>,
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
  let snippetHits = 0;

  for (const { url, title, listingPrice, packQuantity, source, sellerName, sellerId, searchSnippet } of candidates.slice(0, limit)) {
    const isSeller = source === "seller-agent";
    const extracted = await extractFromListing(exa, url, title, agent, { listingPrice, packQuantity, searchSnippet });
    if (!extracted) {
      if (!isSeller) skipped++;
      continue;
    }

    const { total, packsNeeded, priceDetail } = computeOrderTotal(agent, extracted.listingPrice, extracted.packQuantity);
    if (total > agent.trigger.threshold * 1.05) {
      if (!isSeller) skipped++;
      continue;
    }
    const perUnit = extracted.listingPrice / Math.max(1, extracted.packQuantity);
    const marketplace = url.includes("lazada.sg") ? "Lazada" : url.includes("shopee.sg") ? "Shopee" : url.includes("carousell.sg") ? "Carousell" : "Exa";
    const priceLabel = `S$${perUnit.toFixed(2)}/${agent.unit.replace(/s$/, "")} · order S$${total.toFixed(2)}`;
    if (isSeller) {
      progress(`  ✓ Seller Agent: ${priceLabel} — ${title.slice(0, 40)}`);
    } else if (extracted.priceSource === "search-snippet") {
      snippetHits++;
      progress(`  ✓ Exa highlight (${marketplace}): ${priceLabel} — ${extracted.supplier.slice(0, 40)}`);
    } else {
      progress(`  ✓ Exa page (${marketplace}): ${priceLabel} — ${extracted.supplier.slice(0, 40)}`);
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
    progress(`  (${skipped} listing(s) skipped — no price in search highlights or page)`);
  }
  if (snippetHits > 0 && label === "Exa") {
    progress(`  (${snippetHits} priced from Exa search highlights — no page fetch needed)`);
  }

  return { options, extractedMap };
}

async function mergeSellerAgentOptions(
  exa: Exa,
  agent: Agent,
  options: ListingOption[],
  extractedMap: Map<number, { highlights?: string[]; imageUrl?: string; source?: ScrapeResult["source"]; sellerName?: string; sellerAgentId?: string }>,
  progress: (msg: string) => void
) {
  const sellerHits = searchSellerAgentFallback(agent, progress, { quiet: true });
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
          contents: { highlights: { query: `price SGD ${agent.product}`, maxCharacters: 900 } },
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
          progress(`Exa — reading prices from search highlights…`);
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
        await mergeSellerAgentOptions(exa, agent, options, extractedMap, progress);
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
