import type { Agent } from "../types.js";

function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function listingRelevanceScore(agent: Agent, title: string, url: string): number {
  const blob = `${title} ${url}`.toLowerCase();
  const normBlob = normalizeForMatch(blob);
  const words = `${agent.product} ${agent.prompt ?? ""}`
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2 && !["customised", "customized", "custom", "cake", "cakes"].includes(w));

  let score = 0;
  for (const w of words) {
    const n = normalizeForMatch(w);
    if (n.length >= 3 && normBlob.includes(n)) score += 2;
  }

  if (normBlob.includes("shinchan") && normalizeForMatch(agent.product + (agent.prompt ?? "")).includes("shin")) {
    score += 4;
  }

  if (url.includes("carousell.sg/p/")) score += 1;
  return score;
}
