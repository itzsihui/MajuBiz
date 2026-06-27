import type { Agent } from "../types.js";
import { getOrCreateSellerAgent } from "./dynamicSellerAgent.js";
import { searchSellerAgentCatalog, type SellerAgentCandidate } from "./sellerAgentSearch.js";

/** Seller-agent fallback only — no Brave/Shopee API noise in the activity log */
export function searchSellerAgentFallback(
  agent: Agent,
  progress?: (msg: string) => void,
  opts?: { quiet?: boolean }
): SellerAgentCandidate[] {
  if (!opts?.quiet) {
    const sellerAgent = getOrCreateSellerAgent(agent);
    progress?.(`Seller Agent — ${sellerAgent.name} responding with quotes…`);
  }
  return searchSellerAgentCatalog(agent, 8);
}
