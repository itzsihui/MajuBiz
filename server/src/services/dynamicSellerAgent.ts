import type { Agent } from "../types.js";
import type { SellerAgent, SellerListing } from "../data/sellerAgents.js";

function hashString(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return h;
}

function titleCase(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function extractKeywords(product: string, prompt?: string): string[] {
  const blob = `${product} ${prompt ?? ""}`.toLowerCase();
  const words = blob.split(/\s+/).filter((w) => w.length > 2);
  const unique = new Set<string>([product.toLowerCase(), ...words]);
  return [...unique].slice(0, 12);
}

function inferChannel(product: string): { host: string; pathPrefix: string } {
  const p = product.toLowerCase();
  if (/cake|bake|custom|character|birthday/.test(p)) {
    return { host: "carousell.sg", pathPrefix: "p" };
  }
  return { host: "shopee.sg", pathPrefix: "product" };
}

function makeUen(seed: string): string {
  const n = (hashString(seed) % 9_000_000) + 1_000_000;
  return `20${n}A`;
}

function pickPackSizes(quantity: number): number[] {
  const sizes = new Set<number>([Math.max(1, quantity)]);
  if (quantity > 1) sizes.add(Math.max(1, Math.ceil(quantity / 2)));
  if (quantity >= 10) sizes.add(Math.max(1, Math.ceil(quantity / 5)));
  if (quantity > 5) sizes.add(1);
  return [...sizes].sort((a, b) => b - a).slice(0, 3);
}

function packLabel(packQty: number, unit: string, tier: number): string {
  const tierName = ["Bulk", "Standard", "Retail"][tier] ?? "Standard";
  if (packQty <= 1) return `${titleCase(unit)} — ${tierName} (1 ${unit})`;
  return `${titleCase(unit)} — ${tierName} (${packQty} ${unit})`;
}

function listingPriceForPack(packQty: number, orderQty: number, threshold: number, tier: number): number {
  const packsNeeded = Math.max(1, Math.ceil(orderQty / packQty));
  const targetFraction = [0.68, 0.78, 0.88][tier] ?? 0.75;
  const targetTotal = Math.max(1, threshold * targetFraction);
  const raw = targetTotal / packsNeeded;
  return Math.max(0.5, Math.round(raw * 100) / 100);
}

function buildListingUrl(product: string, listingId: string): string {
  const { host, pathPrefix } = inferChannel(product);
  const slug = slugify(product);
  const shopId = (hashString(product) % 90_000_000) + 10_000_000;
  const itemId = hashString(listingId) % 900_000_000;

  if (host === "carousell.sg") {
    return `https://www.carousell.sg/${pathPrefix}/${slug}-agent-listing-${itemId}/`;
  }
  return `https://shopee.sg/${slug}-i.${shopId}.${itemId}`;
}

export interface BuyerContext {
  product: string;
  quantity: number;
  unit: string;
  threshold: number;
  prompt?: string;
  agentId?: string;
}

function contextFromAgent(agent: Agent): BuyerContext {
  return {
    product: agent.product,
    quantity: agent.quantity,
    unit: agent.unit,
    threshold: agent.trigger.threshold,
    prompt: agent.prompt,
    agentId: agent.agentId,
  };
}

export function generateSellerAgent(ctx: BuyerContext): SellerAgent {
  const seed = `${ctx.product}|${ctx.agentId ?? "anon"}`;
  const sellerId = `seller_${hashString(seed).toString(36)}`;
  const productTitle = titleCase(ctx.product.trim() || "Supplies");
  const name = `${productTitle} Seller Agent`;
  const keywords = extractKeywords(ctx.product, ctx.prompt);
  const packSizes = pickPackSizes(Math.max(1, ctx.quantity));

  const listings: SellerListing[] = packSizes.map((packQty, tier) => {
    const listingId = `lst_${hashString(`${sellerId}_${packQty}_${tier}`).toString(36)}`;
    const listingPriceSgd = listingPriceForPack(packQty, ctx.quantity, ctx.threshold, tier);
    const title = `${productTitle} — ${packLabel(packQty, ctx.unit, tier)}`;

    return {
      id: listingId,
      sellerId,
      sellerName: name,
      title,
      description: `Agent-ready quote for ${ctx.quantity} ${ctx.unit} of ${ctx.product}. Structured JSON — no scraping.`,
      keywords,
      listingPriceSgd,
      packQuantity: packQty,
      unit: ctx.unit,
      currency: "SGD",
      url: buildListingUrl(ctx.product, listingId),
      inStock: true,
    };
  });

  const agent: SellerAgent = {
    id: sellerId,
    name,
    uen: makeUen(seed),
    tagline: `Dynamic seller agent for ${productTitle} — Singapore SME catalogue`,
    listings,
  };

  registerListings(listings);
  return agent;
}

const agentCache = new Map<string, SellerAgent>();
const listingRegistry = new Map<string, SellerListing>();

function registerListings(listings: SellerListing[]) {
  for (const listing of listings) {
    listingRegistry.set(listing.id, listing);
  }
}

export function getOrCreateSellerAgent(agent: Agent): SellerAgent {
  const cached = agentCache.get(agent.agentId);
  if (cached) return cached;

  const created = generateSellerAgent(contextFromAgent(agent));
  agentCache.set(agent.agentId, created);
  return created;
}

export function getOrCreateSellerAgentForQuery(
  query: string,
  opts?: { quantity?: number; unit?: string; threshold?: number }
): SellerAgent {
  const product = query.trim() || "supplies";
  const seed = `q:${product.toLowerCase()}`;
  const cached = agentCache.get(seed);
  if (cached) return cached;

  const created = generateSellerAgent({
    product,
    quantity: opts?.quantity ?? 1,
    unit: opts?.unit ?? "units",
    threshold: opts?.threshold ?? 50,
  });
  agentCache.set(seed, created);
  return created;
}

export function getSellerListingById(id: string): SellerListing | undefined {
  return listingRegistry.get(id);
}

export function allRegisteredListings(): SellerListing[] {
  return [...listingRegistry.values()];
}
