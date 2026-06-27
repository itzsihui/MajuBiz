import OpenAI from "openai";
import type { ParsedAgentConfig } from "../types.js";

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

function regexParse(prompt: string): ParsedAgentConfig {
  const lower = prompt.toLowerCase();
  const thresholdMatch = prompt.match(/\$?\s*(\d+(?:\.\d+)?)/);
  const threshold = thresholdMatch ? parseFloat(thresholdMatch[1]) : 10;
  const qtyMatch = prompt.match(/(\d+)\s*(rolls?|boxes?|units?|packs?|kg|pieces?)/i);
  const quantity = qtyMatch ? parseInt(qtyMatch[1], 10) : 50;
  const unit = qtyMatch?.[2]?.toLowerCase() ?? "rolls";

  let product = "bubble wrap";
  if (lower.includes("carton") || lower.includes("box")) product = "carton boxes";
  else if (lower.includes("tape")) product = "packaging tape";
  else if (lower.includes("bubble")) product = "bubble wrap";

  return {
    name: `${product.replace(/\b\w/g, (c) => c.toUpperCase())} Restock Agent`,
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
        {
          role: "system",
          content:
            "Parse a Singapore SME shop owner's natural language into agent purchase rules. Use SGD. Be concise with agent name.",
        },
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
    const config = JSON.parse(raw) as ParsedAgentConfig;
    return { config, provider: "openai" };
  } catch {
    return { config: regexParse(prompt), provider: "fallback" };
  }
}
