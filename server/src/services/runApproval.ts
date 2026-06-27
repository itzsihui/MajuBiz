import type { Agent, ScrapeResult } from "../types.js";
import type { BrainDecision } from "./agentBrain.js";

export interface PurchaseProposal {
  agentId: string;
  agentName: string;
  product: string;
  quantity: number;
  unit: string;
  title: string;
  url: string;
  totalPrice: number;
  priceDetail: string;
  listingPrice: number;
  brainSummary: string;
  thoughts: string[];
  verdictReason?: string;
  imageUrl?: string;
  sellerName?: string;
  source?: ScrapeResult["source"];
}

interface PendingRun {
  agent: Agent;
  scrape: ScrapeResult;
  brain: BrainDecision;
  resolve: (approved: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingRun>();

export function buildProposal(agent: Agent, scrape: ScrapeResult, brain: BrainDecision): PurchaseProposal {
  const verdict = brain.verdicts.find((v) => v.relevant && v.index === brain.selectedIndex);
  return {
    agentId: agent.agentId,
    agentName: agent.name,
    product: agent.product,
    quantity: agent.quantity,
    unit: agent.unit,
    title: scrape.supplier,
    url: scrape.url,
    totalPrice: scrape.price,
    priceDetail: scrape.priceDetail ?? "",
    listingPrice: scrape.listingPrice ?? scrape.price,
    brainSummary: brain.summary,
    thoughts: brain.thoughts,
    verdictReason: verdict?.reason ?? scrape.relevanceReason,
    imageUrl: scrape.imageUrl,
    sellerName: scrape.sellerName,
    source: scrape.source,
  };
}

export function waitForRunApproval(
  runId: string,
  agent: Agent,
  scrape: ScrapeResult,
  brain: BrainDecision,
  timeoutMs = 5 * 60 * 1000
): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(runId);
      resolve(false);
    }, timeoutMs);

    pending.set(runId, { agent, scrape, brain, resolve, timer });
  });
}

export function resolveRunApproval(runId: string, approved: boolean): boolean {
  const entry = pending.get(runId);
  if (!entry) return false;
  clearTimeout(entry.timer);
  pending.delete(runId);
  entry.resolve(approved);
  return true;
}

export function getPendingApproval(runId: string): PurchaseProposal | null {
  const entry = pending.get(runId);
  if (!entry) return null;
  return buildProposal(entry.agent, entry.scrape, entry.brain);
}
