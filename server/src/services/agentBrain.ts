import OpenAI from "openai";
import type { Agent } from "../types.js";
import { extractIntentModifiers, isLikelyWrongSubtype } from "./productMatch.js";
export interface ListingOption {
  index: number;
  title: string;
  url: string;
  totalPrice: number;
  priceDetail: string;
  listingPrice: number;
  packQuantity: number;
  packsNeeded: number;
}

export interface ListingVerdict {
  index: number;
  relevant: boolean;
  reason: string;
}

export interface BrainDecision {
  thoughts: string[];
  verdicts: ListingVerdict[];
  selectedIndex: number | null;
  cheapestAmongRelevant: number | null;
  summary: string;
}

function fallbackBrain(agent: Agent, options: ListingOption[]): BrainDecision {
  const thoughts: string[] = [
    `Goal: buy ${agent.quantity} ${agent.unit} of "${agent.product}" if total ≤ S$${agent.trigger.threshold.toFixed(2)}`,
    `Exa returned ${options.length} listing(s) to review (OpenAI unavailable — using basic match)`,
  ];

  const productWords = agent.product
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3);

  const modifiers = extractIntentModifiers(agent);
  const verdicts: ListingVerdict[] = options.map((o) => {
    const blob = `${o.title} ${o.url}`.toLowerCase();
    const normBlob = blob.replace(/[^a-z0-9]/g, "");
    const hits = productWords.filter((w) => blob.includes(w) || normBlob.includes(w.replace(/[^a-z0-9]/g, "")));
    const wrongSubtype = isLikelyWrongSubtype(agent, o.title, o.url);
    const shinMatch =
      normBlob.includes("shinchan") &&
      (agent.product + (agent.prompt ?? "")).toLowerCase().replace(/[^a-z0-9]/g, "").includes("shin");
    const velcroListing = /velcro|hook.?loop|fastener/i.test(blob);
    const genericTapeRequest = /\btape\b/i.test(agent.product) && modifiers.length === 0;
    const relevant =
      !wrongSubtype &&
      ! (genericTapeRequest && velcroListing) &&
      (shinMatch || (productWords.length === 0 ? true : hits.length >= Math.ceil(productWords.length * 0.5)));
    thoughts.push(
      relevant
        ? `✓ "${o.title.slice(0, 50)}…" — matches (${hits.join(", ") || "generic"}) · ${o.priceDetail}`
        : `✗ "${o.title.slice(0, 50)}…" — rejected (missing key terms for "${agent.product}")`
    );
    return {
      index: o.index,
      relevant,
      reason: relevant ? `Matches ${hits.join(", ") || "product"}` : wrongSubtype ? "Wrong product subtype" : "Product name mismatch",
    };
  });

  const relevant = options.filter((o) => verdicts.find((v) => v.index === o.index)?.relevant);
  if (relevant.length === 0) {
    return {
      thoughts: [...thoughts, "No relevant listings — will not purchase"],
      verdicts,
      selectedIndex: null,
      cheapestAmongRelevant: null,
      summary: "No listing matched your product",
    };
  }

  relevant.sort((a, b) => a.totalPrice - b.totalPrice);
  const cheapest = relevant[0];
  thoughts.push(
    `Compared ${relevant.length} relevant listing(s) by total order cost:`,
    ...relevant.map((r, i) => `  ${i + 1}. S$${r.totalPrice.toFixed(2)} — ${r.title.slice(0, 55)}…`),
    `Cheapest relevant option: S$${cheapest.totalPrice.toFixed(2)} (${cheapest.title.slice(0, 40)}…)`,
  );

  const underBudget = cheapest.totalPrice < agent.trigger.threshold;
  if (!underBudget) {
    thoughts.push(
      `Cheapest is S$${cheapest.totalPrice.toFixed(2)} but budget cap is S$${agent.trigger.threshold.toFixed(2)} — no purchase`,
    );
    return {
      thoughts,
      verdicts,
      selectedIndex: null,
      cheapestAmongRelevant: cheapest.index,
      summary: `Cheapest relevant is S$${cheapest.totalPrice.toFixed(2)} — above S$${agent.trigger.threshold.toFixed(2)} threshold`,
    };
  }

  thoughts.push(`Selected cheapest relevant listing at S$${cheapest.totalPrice.toFixed(2)} — proceeding to PayNow`);
  return {
    thoughts,
    verdicts,
    selectedIndex: cheapest.index,
    cheapestAmongRelevant: cheapest.index,
    summary: `Cheapest match: S$${cheapest.totalPrice.toFixed(2)} — ${cheapest.title.slice(0, 50)}`,
  };
}

export async function decidePurchase(
  agent: Agent,
  options: ListingOption[],
  listingCount = options.length
): Promise<BrainDecision> {
  if (options.length === 0) {
    return {
      thoughts: [`Searched for "${agent.product}" but found no product listing URLs`],
      verdicts: [],
      selectedIndex: null,
      cheapestAmongRelevant: null,
      summary: "No listings found on Shopee/Carousell/Lazada",
    };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.startsWith("sk-...")) {
    return fallbackBrain(agent, options);
  }

  const modifiers = extractIntentModifiers(agent);
  const intentNote =
    modifiers.length > 0
      ? `Specific intent: ${modifiers.join(", ")}`
      : `Generic request — prefer the most typical match for "${agent.product}"`;

  const isRestock = /auto-restock|restock/i.test(agent.prompt);
  const unitBudget =
    agent.quantity > 0 ? Math.round((agent.trigger.threshold / agent.quantity) * 100) / 100 : null;
  const budgetNote = isRestock && unitBudget
    ? `Inventory restock — max S$${unitBudget.toFixed(2)} per ${agent.unit.replace(/s$/, "")} (S$${agent.trigger.threshold.toFixed(2)} total for ${agent.quantity} ${agent.unit})`
    : `Max budget (total): S$${agent.trigger.threshold.toFixed(2)}`;

  const listingBlock = options
    .map(
      (o) =>
        `[${o.index}] "${o.title}"\n  URL: ${o.url}\n  ${o.priceDetail}\n  Total for order: S$${o.totalPrice.toFixed(2)}`
    )
    .join("\n\n");

  try {
    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are MajuBiz Agent Brain — an autonomous procurement agent for Singapore SMEs.
Think step-by-step out loud, then decide which listing (if any) to buy.

Rules:
- Be STRICT on category mismatches (phone vs cake, Mac mini vs MacBook).
- Be STRICT on product subtypes: clear/OPP/packing tape ≠ velcro hook-and-loop fasteners; duct tape ≠ masking tape.
- For generic "tape" restock requests, prefer packing tape / OPP clear tape — reject velcro fasteners unless explicitly requested.
- But be SMART on naming: URL slugs and titles may use hyphens or spacing — "shin-chan" / "shin chan" / "shinchan" are the SAME character for cake requests.
- Customised cake listings on Carousell often include the character/theme in the URL path — trust the URL slug if it matches the request.
- Only select listings that truly match what the owner asked to buy.
- Among RELEVANT listings, pick the CHEAPEST total order cost.
- Only purchase if cheapest relevant total ≤ budget threshold S$${agent.trigger.threshold.toFixed(2)}${isRestock && unitBudget ? ` (≈ S$${unitBudget.toFixed(2)} per unit)` : ""}.
- If selectedIndex is -1, no purchase.
- thoughts: 4-8 short sentences showing your reasoning chain.`,
        },
        {
          role: "user",
          content: `Owner's original request:
"${agent.prompt}"

Parsed product: "${agent.product}"
Quantity: ${agent.quantity} ${agent.unit}
${budgetNote}
${intentNote}

Listings found by Exa web search (${listingCount} URLs ranked, showing ${options.length}):
${listingBlock}

Each listing includes URL — read the URL slug for product hints.
Analyze each listing, reject mismatches (especially wrong subtypes), compare prices of valid ones, pick cheapest if under budget.`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "purchase_decision",
          strict: true,
          schema: {
            type: "object",
            properties: {
              thoughts: {
                type: "array",
                items: { type: "string" },
              },
              verdicts: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    index: { type: "number" },
                    relevant: { type: "boolean" },
                    reason: { type: "string" },
                  },
                  required: ["index", "relevant", "reason"],
                  additionalProperties: false,
                },
              },
              selectedIndex: {
                type: "number",
                description: "Index of cheapest relevant listing under budget, or -1 if none",
              },
              summary: { type: "string" },
            },
            required: ["thoughts", "verdicts", "selectedIndex", "summary"],
            additionalProperties: false,
          },
        },
      },
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) return fallbackBrain(agent, options);

    const parsed = JSON.parse(raw) as {
      thoughts: string[];
      verdicts: ListingVerdict[];
      selectedIndex: number;
      summary: string;
    };

    const selectedIndex = parsed.selectedIndex >= 0 ? parsed.selectedIndex : null;

    const relevant = options.filter((o) =>
      parsed.verdicts.find((v) => v.index === o.index && v.relevant)
    );
    const cheapestAmongRelevant =
      relevant.length > 0
        ? relevant.reduce((a, b) => (a.totalPrice < b.totalPrice ? a : b)).index
        : null;

    return {
      thoughts: parsed.thoughts,
      verdicts: parsed.verdicts,
      selectedIndex,
      cheapestAmongRelevant,
      summary: parsed.summary,
    };
  } catch {
    return fallbackBrain(agent, options);
  }
}
