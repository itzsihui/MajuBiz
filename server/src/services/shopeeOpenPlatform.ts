import crypto from "crypto";
import type { Agent } from "../types.js";
import { matchesProductKeywords } from "./productMatch.js";

export interface ShopeeOpenListing {
  itemId: number;
  title: string;
  url: string;
  listingPrice: number;
  packQuantity: number;
}

const HOST = process.env.SHOPEE_API_HOST ?? "https://partner.shopeemobile.com";

function configured(): {
  partnerId: number;
  partnerKey: string;
  accessToken: string;
  shopId: number;
} | null {
  const partnerId = process.env.SHOPEE_PARTNER_ID;
  const partnerKey = process.env.SHOPEE_PARTNER_KEY;
  const accessToken = process.env.SHOPEE_ACCESS_TOKEN;
  const shopId = process.env.SHOPEE_SHOP_ID;
  if (!partnerId || !partnerKey || !accessToken || !shopId) return null;
  return {
    partnerId: parseInt(partnerId, 10),
    partnerKey,
    accessToken,
    shopId: parseInt(shopId, 10),
  };
}

function hmacSign(
  path: string,
  timestamp: number,
  accessToken: string,
  shopId: number,
  partnerId: number,
  partnerKey: string
): string {
  const base = `${partnerId}${path}${timestamp}${accessToken}${shopId}`;
  return crypto.createHmac("sha256", partnerKey).update(base).digest("hex");
}

async function shopGet<T>(path: string, params: Record<string, string>, cfg: NonNullable<ReturnType<typeof configured>>): Promise<T> {
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = hmacSign(path, timestamp, cfg.accessToken, cfg.shopId, cfg.partnerId, cfg.partnerKey);
  const qs = new URLSearchParams({
    partner_id: String(cfg.partnerId),
    timestamp: String(timestamp),
    sign,
    access_token: cfg.accessToken,
    shop_id: String(cfg.shopId),
    ...params,
  });
  const res = await fetch(`${HOST}${path}?${qs}`, {
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`Shopee Open API HTTP ${res.status}`);
  const data = (await res.json()) as { error?: string; message?: string; response?: T };
  if (data.error) throw new Error(data.message ?? data.error);
  return data.response as T;
}

function itemUrl(title: string, shopId: number, itemId: number): string {
  const slug = title.replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").slice(0, 80);
  return `https://shopee.sg/${slug}-i.${shopId}.${itemId}`;
}

/**
 * Shopee Open Platform v2.product.search_item — searches ONE authorized seller shop.
 * Docs: https://open.shopee.com/documents/v2/v2.product.search_item
 *
 * NOT the same as shopee.sg/search — requires partner app + seller OAuth (shop_id + access_token).
 */
export async function searchShopeeOpenPlatform(agent: Agent): Promise<ShopeeOpenListing[]> {
  const cfg = configured();
  if (!cfg) return [];

  const searchPath = "/api/v2/product/search_item";
  const search = await shopGet<{ item_id_list?: number[] }>(searchPath, {
    item_name: agent.product,
    page_size: "20",
    offset: "0",
  }, cfg);

  const itemIds = search.item_id_list ?? [];
  if (!itemIds.length) return [];

  const infoPath = "/api/v2/product/get_item_base_info";
  const info = await shopGet<{
    item_list?: Array<{
      item_id: number;
      item_name?: string;
      price_info?: Array<{ current_price?: number; original_price?: number }>;
    }>;
  }>(infoPath, {
    item_id_list: itemIds.slice(0, 20).join(","),
  }, cfg);

  const out: ShopeeOpenListing[] = [];
  for (const item of info.item_list ?? []) {
    const title = item.item_name ?? agent.product;
    const url = itemUrl(title, cfg.shopId, item.item_id);
    if (!matchesProductKeywords(agent, title, url)) continue;
    const priceRaw = item.price_info?.[0]?.current_price ?? item.price_info?.[0]?.original_price;
    if (!priceRaw || priceRaw <= 0) continue;
    out.push({
      itemId: item.item_id,
      title,
      url,
      listingPrice: priceRaw / 100_000,
      packQuantity: 1,
    });
  }
  return out;
}

export function shopeeOpenPlatformConfigured(): boolean {
  return configured() !== null;
}

export function shopeeOpenPlatformSetupHint(): string {
  return "Register at open.shopee.com → create app → seller OAuth → set SHOPEE_PARTNER_ID, SHOPEE_PARTNER_KEY, SHOPEE_ACCESS_TOKEN, SHOPEE_SHOP_ID in server/.env";
}
