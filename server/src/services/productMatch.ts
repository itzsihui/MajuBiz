import type { Agent } from "../types.js";

const STOP_WORDS = new Set([
  "customised",
  "customized",
  "custom",
  "cake",
  "cakes",
  "buy",
  "help",
  "me",
  "the",
  "and",
  "for",
  "with",
]);

const TYPE_MODIFIERS: Record<string, string[]> = {
  clear: ["clear", "opp", "transparent"],
  packing: ["packing", "parcel", "carton", "sealing"],
  masking: ["masking"],
  duct: ["duct", "cloth"],
  velcro: ["velcro", "hook", "loop", "fastener"],
  bubble: ["bubble", "wrap"],
};

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function productIntentBlob(agent: Agent): string {
  return `${agent.product} ${agent.prompt ?? ""}`.toLowerCase();
}

export function extractIntentModifiers(agent: Agent): string[] {
  const blob = productIntentBlob(agent);
  const found: string[] = [];
  for (const [key, terms] of Object.entries(TYPE_MODIFIERS)) {
    if (terms.some((t) => blob.includes(t))) found.push(key);
  }
  return found;
}

export function listingRelevanceScore(agent: Agent, title: string, url: string): number {
  const blob = `${title} ${url}`.toLowerCase();
  const normBlob = normalize(blob);
  const intent = productIntentBlob(agent);

  const words = intent
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  let score = 0;
  for (const w of words) {
    const n = normalize(w);
    if (n.length >= 3 && normBlob.includes(n)) score += 2;
  }

  const modifiers = extractIntentModifiers(agent);
  const listingTypes = extractListingTypes(blob);

  if (modifiers.length > 0) {
    const wanted = new Set(modifiers.flatMap((m) => TYPE_MODIFIERS[m] ?? [m]));
    const listingNorm = listingTypes.map(normalize);
    if ([...wanted].some((w) => listingNorm.some((l) => l.includes(normalize(w))))) {
      score += 5;
    }
    // Penalise wrong tape subtypes
    if (modifiers.some((m) => ["clear", "packing", "masking", "duct"].includes(m))) {
      if (listingTypes.some((t) => ["velcro", "hook", "loop", "fastener"].includes(t))) score -= 8;
    }
    if (modifiers.includes("velcro") && listingTypes.some((t) => ["opp", "clear", "packing"].includes(t))) {
      score -= 4;
    }
  }

  if (normBlob.includes("shinchan") && normalize(intent).includes("shin")) score += 4;
  if (blob.includes("help-to-buy") || blob.includes("help to buy")) score -= 6;
  if (url.includes("carousell.sg/p/")) score += 1;
  if (url.includes("shopee.sg")) score += 1;
  if (url.includes("lazada.sg")) score += 1;

  return score;
}

function extractListingTypes(blob: string): string[] {
  const types: string[] = [];
  for (const terms of Object.values(TYPE_MODIFIERS)) {
    for (const t of terms) {
      if (blob.includes(t)) types.push(t);
    }
  }
  return types;
}

const PRODUCT_STOP = new Set(["buy", "help", "the", "and", "for", "with", "when", "below", "price", "monitor", "automatically", "purchase"]);

export function getProductExcludePatterns(agent: Agent): RegExp[] {
  const product = agent.product.toLowerCase();
  if (product.includes("bubble") && product.includes("wrap")) {
    return [
      /cling\s*wrap/i,
      /stretch\s*film/i,
      /shrink\s*film/i,
      /pvc\s*film/i,
      /food\s*wrap/i,
      /burger\s*paper/i,
      /bouquet/i,
      /chefwrap/i,
      /bubble\s*tea/i,
      /bubble\s*gum/i,
      /blackhead\s*bubble/i,
      /bubble\s*letters/i,
      /bubblebee/i,
      /window\s*envelope/i,
    ];
  }
  return [];
}

export function matchesProductKeywords(agent: Agent, title: string, url: string): boolean {
  const blob = `${title} ${url}`.toLowerCase();
  if (getProductExcludePatterns(agent).some((p) => p.test(blob))) return false;

  const words = agent.product
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2 && !PRODUCT_STOP.has(w));

  if (words.length === 0) return true;
  const normBlob = normalize(blob);
  return words.every((w) => blob.includes(w) || normBlob.includes(normalize(w)));
}

export function isLikelyWrongSubtype(agent: Agent, title: string, url: string): boolean {
  const modifiers = extractIntentModifiers(agent);
  if (modifiers.length === 0) return false;
  const listingTypes = extractListingTypes(`${title} ${url}`.toLowerCase());
  if (listingTypes.length === 0) return false;

  const wanted = new Set(modifiers);
  const hasVelcro = listingTypes.some((t) => ["velcro", "hook", "loop", "fastener"].includes(t));
  const wantsClearOrPacking = wanted.has("clear") || wanted.has("packing") || wanted.has("masking");
  if (wantsClearOrPacking && hasVelcro) return true;

  return false;
}
