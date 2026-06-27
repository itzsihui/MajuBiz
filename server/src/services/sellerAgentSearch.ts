import type { Agent } from "../types.js";
import type { SellerListing } from "../data/sellerAgents.js";
import {
  getOrCreateSellerAgent,
  getOrCreateSellerAgentForQuery,
  getSellerListingById,
} from "./dynamicSellerAgent.js";
import { listingRelevanceScore, matchesProductKeywords } from "./productMatch.js";

export interface SellerAgentCandidate {
  url: string;
  title: string;
  score: number;
  source: "seller-agent";
  listingPrice: number;
  packQuantity: number;
  sellerListingId: string;
  sellerName: string;
  sellerId: string;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function scoreListing(agent: Agent, listing: SellerListing): number {
  const blob = `${listing.title} ${listing.description} ${listing.keywords.join(" ")}`.toLowerCase();
  const base = listingRelevanceScore(agent, listing.title, listing.url);
  let bonus = 0;
  for (const kw of listing.keywords) {
    if (normalize(agent.product).includes(normalize(kw)) || normalize(agent.prompt ?? "").includes(normalize(kw))) {
      bonus += 1;
    }
  }
  if (blob.includes(normalize(agent.product))) bonus += 3;
  return base + bonus + 8;
}

export function searchSellerAgentCatalog(agent: Agent, limit = 8): SellerAgentCandidate[] {
  const sellerAgent = getOrCreateSellerAgent(agent);
  const results: SellerAgentCandidate[] = [];

  for (const listing of sellerAgent.listings) {
    if (!listing.inStock) continue;
    if (!matchesProductKeywords(agent, `${listing.title} ${listing.keywords.join(" ")}`, listing.url)) continue;

    results.push({
      url: listing.url,
      title: listing.title,
      listingPrice: listing.listingPriceSgd,
      packQuantity: listing.packQuantity,
      source: "seller-agent",
      score: scoreListing(agent, listing),
      sellerListingId: listing.id,
      sellerName: listing.sellerName,
      sellerId: sellerAgent.id,
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

export function searchSellerAgentCatalogByQuery(
  query: string,
  limit = 10,
  opts?: { quantity?: number; unit?: string; threshold?: number }
): { seller: ReturnType<typeof getOrCreateSellerAgentForQuery>; listings: SellerListing[] } {
  const seller = getOrCreateSellerAgentForQuery(query, opts);
  const q = normalize(query);
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);

  const listings = seller.listings
    .filter((l) => {
      const blob = normalize(`${l.title} ${l.description} ${l.keywords.join(" ")}`);
      return words.length === 0 ? blob.includes(q) : words.every((w) => blob.includes(normalize(w)));
    })
    .slice(0, limit);

  return { seller, listings };
}

export function quoteSellerListing(listingId: string, quantity: number, unit: string) {
  const listing = getSellerListingById(listingId);
  if (!listing) return null;

  const packsNeeded = Math.max(1, Math.ceil(quantity / listing.packQuantity));
  const total = Math.round(packsNeeded * listing.listingPriceSgd * 100) / 100;

  return {
    listing,
    quantity,
    unit,
    packsNeeded,
    listingPriceSgd: listing.listingPriceSgd,
    packQuantity: listing.packQuantity,
    totalPriceSgd: total,
    currency: "SGD" as const,
    priceDetail: `S$${listing.listingPriceSgd.toFixed(2)}/pack (${listing.packQuantity} ${listing.unit}) × ${packsNeeded} pack${packsNeeded > 1 ? "s" : ""} = S$${total.toFixed(2)} for ${quantity} ${unit}`,
  };
}
