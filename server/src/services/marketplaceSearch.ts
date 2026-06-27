import type { Agent } from "../types.js";
import { getOrCreateSellerAgent } from "./dynamicSellerAgent.js";
import { listingRelevanceScore, matchesProductKeywords } from "./productMatch.js";
import { searchSellerAgentCatalog } from "./sellerAgentSearch.js";
import {
  searchShopeeOpenPlatform,
  shopeeOpenPlatformConfigured,
  shopeeOpenPlatformSetupHint,
} from "./shopeeOpenPlatform.js";

export interface MarketplaceCandidate {
  url: string;
  title: string;
  score: number;
  source: "brave" | "shopee-api" | "shopee-open" | "seller-agent";
  listingPrice?: number;
  packQuantity?: number;
  sellerListingId?: string;
  sellerName?: string;
  sellerId?: string;
}

const FETCH_TIMEOUT_MS = 12_000;

function fetchWithTimeout(url: string, init: RequestInit = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

function slugify(name: string): string {
  return name.replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").slice(0, 80);
}

function addCandidate(
  seen: Set<string>,
  out: MarketplaceCandidate[],
  agent: Agent,
  raw: { url: string; title: string; listingPrice?: number; packQuantity?: number },
  source: MarketplaceCandidate["source"]
) {
  const url = raw.url.split("?")[0];
  if (url.includes("punish") || url.includes("_____tmd_____")) return;
  if (
    source !== "seller-agent" &&
    source !== "shopee-open" &&
    !url.includes("-i.") &&
    !url.includes("/products/") &&
    !url.includes("carousell.sg/p/")
  ) {
    return;
  }
  if (seen.has(url)) return;
  if (!matchesProductKeywords(agent, raw.title, url)) return;
  seen.add(url);
  out.push({
    url,
    title: raw.title,
    listingPrice: raw.listingPrice,
    packQuantity: raw.packQuantity,
    source,
    score: listingRelevanceScore(agent, raw.title, url) + (source === "shopee-api" || source === "shopee-open" ? 3 : 1),
  });
}

async function searchBrave(product: string): Promise<Array<{ url: string; title: string }>> {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) return [];

  const queries = [
    `site:shopee.sg ${product}`,
    `site:shopee.sg ${product} roll packaging Singapore`,
    `site:lazada.sg ${product}`,
  ];

  const found: Array<{ url: string; title: string }> = [];
  const seen = new Set<string>();

  for (const q of queries) {
    const res = await fetchWithTimeout(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=15`,
      {
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": key,
        },
      }
    );
    if (!res.ok) continue;
    const data = (await res.json()) as {
      web?: { results?: Array<{ title?: string; url?: string }> };
    };
    for (const row of data.web?.results ?? []) {
      if (!row.url || !row.title) continue;
      const url = row.url.split("?")[0];
      if (seen.has(url)) continue;
      if (!url.includes("shopee.sg") && !url.includes("lazada.sg") && !url.includes("carousell.sg")) continue;
      seen.add(url);
      found.push({ url, title: row.title });
    }
  }

  return found;
}

async function searchShopeeApi(product: string): Promise<
  Array<{ url: string; title: string; listingPrice: number; packQuantity: number }>
> {
  const home = await fetchWithTimeout("https://shopee.sg/", {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
  });

  const rawCookies =
    typeof home.headers.getSetCookie === "function" ? home.headers.getSetCookie() : [];
  const cookieHeader = rawCookies.map((c) => c.split(";")[0]).join("; ");
  const csrf = rawCookies.find((c) => c.startsWith("csrftoken="))?.split(";")[0]?.split("=")[1];

  const apiUrl = `https://shopee.sg/api/v4/search/search_items?by=relevancy&keyword=${encodeURIComponent(product)}&limit=25&newest=0&order=desc&page_type=search&scenario=PAGE_GLOBAL_SEARCH&version=2`;
  const res = await fetchWithTimeout(apiUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Referer: `https://shopee.sg/search?keyword=${encodeURIComponent(product)}`,
      Accept: "application/json",
      "x-api-source": "pc",
      "x-shopee-language": "en",
      ...(csrf ? { "x-csrftoken": csrf } : {}),
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
  });

  if (!res.ok) throw new Error(`Shopee API HTTP ${res.status}`);
  const data = (await res.json()) as {
    error?: number;
    items?: Array<{ item_basic?: { name?: string; price?: number; shopid?: number; itemid?: number } }>;
  };
  if (data.error) throw new Error(`Shopee API error ${data.error}`);

  return (data.items ?? []).map((row) => {
    const b = row.item_basic!;
    const title = b.name ?? "item";
    return {
      title,
      url: `https://shopee.sg/${slugify(title)}-i.${b.shopid}.${b.itemid}`,
      listingPrice: (b.price ?? 0) / 100_000,
      packQuantity: 1,
    };
  });
}

/** Direct marketplace search — bypasses Exa's weak Shopee product index */
export async function searchMarketplaceDirect(
  agent: Agent,
  progress?: (msg: string) => void
): Promise<MarketplaceCandidate[]> {
  const log = (msg: string) => progress?.(msg);
  const seen = new Set<string>();
  const candidates: MarketplaceCandidate[] = [];

  if (process.env.BRAVE_SEARCH_API_KEY) {
    log("Direct web search via Brave (same as Google-style index)…");
    try {
      const brave = await searchBrave(agent.product);
      for (const row of brave) {
        addCandidate(seen, candidates, agent, row, "brave");
      }
      log(`  Brave: ${brave.length} hit(s), ${candidates.length} passed product filter`);
    } catch (err) {
      log(`  Brave search failed: ${err instanceof Error ? err.message : "error"}`);
    }
  } else {
    log("No BRAVE_SEARCH_API_KEY — optional; see brave.com/search/api");
  }

  if (shopeeOpenPlatformConfigured()) {
    log("Shopee Open Platform (official seller API — structured JSON)…");
    try {
      const open = await searchShopeeOpenPlatform(agent);
      for (const row of open) {
        addCandidate(seen, candidates, agent, row, "shopee-open");
      }
      log(`  Shopee Open Platform: ${open.length} item(s) from authorized shop`);
    } catch (err) {
      log(`  Shopee Open Platform failed: ${err instanceof Error ? err.message : "error"}`);
    }
  } else {
    log(`Shopee Open Platform skipped — ${shopeeOpenPlatformSetupHint()}`);
  }

  log("Trying public Shopee search API (often blocked without browser cookies)…");
  try {
    const shopee = await searchShopeeApi(agent.product);
    for (const row of shopee) {
      addCandidate(seen, candidates, agent, row, "shopee-api");
    }
    log(`  Shopee API: ${shopee.length} item(s), ${candidates.length} after filter`);
  } catch (err) {
    log(`  Shopee API unavailable (${err instanceof Error ? err.message : "blocked"})`);
  }

  const sellerAgent = getOrCreateSellerAgent(agent);
  log(`Spawning seller agent for "${agent.product}"…`);
  log(`  → ${sellerAgent.name} (${sellerAgent.uen}) — agent-ready JSON catalogue`);
  const sellerHits = searchSellerAgentCatalog(agent, 8);
  for (const row of sellerHits) {
    if (seen.has(row.url)) continue;
    seen.add(row.url);
    candidates.push(row);
  }
  log(`  ${sellerAgent.name}: ${sellerHits.length} listing(s) with prices — no scraping needed`);

  candidates.sort((a, b) => b.score - a.score);
  for (const c of candidates.slice(0, 4)) {
    log(`  · [${c.source}] [score ${c.score}] ${c.title.slice(0, 55)}…`);
  }

  return candidates;
}

export function marketplaceSearchUrl(agent: Agent): string {
  return `https://shopee.sg/search?keyword=${encodeURIComponent(agent.product)}`;
}
