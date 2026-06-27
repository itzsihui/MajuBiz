import OpenAI from "openai";
import type { AgentTrigger, ParsedAgentConfig } from "../types.js";

const AGENT_SCHEMA = {
  type: "object" as const,
  properties: {
    name: { type: "string" as const, description: "Short agent name for the dashboard" },
    product: { type: "string" as const, description: "Product to monitor or purchase" },
    quantity: { type: "number" as const, description: "Quantity to purchase when triggered" },
    unit: { type: "string" as const, description: "Unit of measure e.g. rolls, boxes, kg" },
    trigger: {
      type: "object" as const,
      properties: {
        type: { type: "string" as const, enum: ["price_below"] },
        threshold: { type: "number" as const, description: "Max price in SGD to auto-buy" },
        currency: { type: "string" as const, enum: ["SGD"] },
      },
      required: ["type", "threshold", "currency"],
      additionalProperties: false,
    },
  },
  required: ["name", "product", "quantity", "unit", "trigger"],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You parse casual natural-language purchase intents from Singapore SME shop owners into structured agent rules.

Rules:
- Use SGD for currency.
- Infer reasonable defaults when details are missing (e.g. "help me buy bubble wrap" → 50 rolls, max S$10 total or per reasonable unit cap).
- Understand typos: dolars, dollars, $, S$, under, below, max, cap.
- Quantity patterns: "2 bubble wrap", "buy 50 rolls", "100 boxes".
- Map products: bubble wrap, carton boxes, packing/packaging tape, etc.
- threshold is the max price in SGD the owner is willing to pay (total or per-unit cap — pick what fits the prompt).
- Always return complete valid JSON. Never refuse vague requests — infer sensible defaults.`;

function extractPriceCap(prompt: string): number | null {
  const lower = prompt.toLowerCase();
  const patterns = [
    /(?:under|below|max|cap|at most|≤|<=)\s*(?:s\$|\$)?\s*(\d+(?:\.\d+)?)/i,
    /(?:s\$|\$)\s*(\d+(?:\.\d+)?)/i,
    /(\d+(?:\.\d+)?)\s*(?:sgd|dolars?|dollars?)/i,
  ];
  for (const re of patterns) {
    const m = prompt.match(re);
    if (m) return parseFloat(m[1]);
  }
  if (lower.includes("cheap") || lower.includes("lowest")) return 15;
  return null;
}

function extractQuantityAndUnit(prompt: string): { quantity: number; unit: string } {
  const withUnit = prompt.match(/(\d+)\s*(rolls?|boxes?|units?|packs?|kg|pieces?|pcs?)/i);
  if (withUnit) {
    return {
      quantity: parseInt(withUnit[1], 10),
      unit: withUnit[2].toLowerCase().replace(/s$/, "") === "roll" ? "rolls" : withUnit[2].toLowerCase(),
    };
  }

  const bareQty = prompt.match(/(?:buy|get|need|order)\s+(\d+)\s+(?!rolls|boxes|units|packs)/i);
  if (bareQty) {
    const n = parseInt(bareQty[1], 10);
    const lower = prompt.toLowerCase();
    if (lower.includes("box") || lower.includes("carton")) return { quantity: n, unit: "boxes" };
    if (lower.includes("tape")) return { quantity: n, unit: "rolls" };
    if (lower.includes("bubble")) return { quantity: n, unit: "rolls" };
    return { quantity: n, unit: "units" };
  }

  return { quantity: 50, unit: "rolls" };
}

function inferProduct(prompt: string): string {
  const lower = prompt.toLowerCase();
  if (lower.includes("carton") || /\bbox(es)?\b/.test(lower)) return "carton boxes";
  if (lower.includes("tape")) return "packaging tape";
  if (lower.includes("bubble")) return "bubble wrap";
  if (lower.includes("cake")) return "custom birthday cake";
  if (lower.includes("shin")) return "shin-chan customised birthday cake";
  return "bubble wrap";
}

function defaultUnitForProduct(product: string): string {
  if (product.includes("box")) return "boxes";
  if (product.includes("tape")) return "rolls";
  if (product.includes("cake")) return "piece";
  return "rolls";
}

function regexParse(prompt: string): ParsedAgentConfig {
  const lower = prompt.toLowerCase();
  const product = inferProduct(prompt);
  let { quantity, unit } = extractQuantityAndUnit(prompt);
  if (unit === "rolls" && !lower.includes("roll") && product.includes("box")) {
    unit = defaultUnitForProduct(product);
  }
  const threshold = extractPriceCap(prompt) ?? (product.includes("cake") ? 50 : 10);

  return {
    name: `${product.replace(/\b\w/g, (c) => c.toUpperCase())} Restock Agent`,
    product,
    quantity,
    unit,
    trigger: { type: "price_below", threshold, currency: "SGD" },
  };
}

export function normalizeParsedConfig(raw: Partial<ParsedAgentConfig> & { trigger?: Partial<AgentTrigger> }): ParsedAgentConfig {
  const product = typeof raw.product === "string" && raw.product.trim() ? raw.product.trim() : "bubble wrap";
  const quantity = Math.max(1, Math.round(Number(raw.quantity) || 50));
  const unit =
    typeof raw.unit === "string" && raw.unit.trim() ? raw.unit.trim() : defaultUnitForProduct(product);
  const threshold = Math.max(0.01, Number(raw.trigger?.threshold) || 10);
  const name =
    typeof raw.name === "string" && raw.name.trim()
      ? raw.name.trim()
      : `${product.replace(/\b\w/g, (c) => c.toUpperCase())} Agent`;

  return {
    name,
    product,
    quantity,
    unit,
    trigger: { type: "price_below", threshold, currency: "SGD" },
  };
}

export async function parseAgentPrompt(
  prompt: string
): Promise<{ config: ParsedAgentConfig; provider: "openai" | "fallback" }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.startsWith("sk-...")) {
    return { config: regexParse(prompt), provider: "fallback" };
  }

  try {
    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "agent_config",
          strict: true,
          schema: AGENT_SCHEMA,
        },
      },
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error("Empty OpenAI response");
    const config = normalizeParsedConfig(JSON.parse(raw) as ParsedAgentConfig);
    return { config, provider: "openai" };
  } catch {
    return { config: regexParse(prompt), provider: "fallback" };
  }
}
