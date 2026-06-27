import type { Agent, PayNowPayload, ScrapeResult } from "../types.js";

function randomRef(): string {
  return `PN2-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export function buildPayNowSettlement(agent: Agent, scrape: ScrapeResult): PayNowPayload {
  const unitPrice = Math.round((scrape.price / agent.quantity) * 100) / 100;

  return {
    scheme: "PayNow-Gen2",
    messageType: "REQUEST_TO_PAY",
    transactionRef: randomRef(),
    amount: { value: scrape.price, currency: "SGD" },
    creditor: {
      name: scrape.supplier,
      uen: "201234567A",
      proxyType: "UEN",
    },
    structuredRemittance: {
      invoiceNumber: `INV-${Math.floor(1000 + Math.random() * 9000)}`,
      lineItems: [
        {
          description: agent.product,
          quantity: agent.quantity,
          unit: agent.unit,
          unitPrice,
        },
      ],
      reconciliationRef: `MAJUBIZ-${agent.agentId}`,
      categoryCode: "WHOLESALE_SUPPLIES",
    },
    agentMetadata: {
      platform: "MajuBiz",
      agentId: agent.agentId,
      triggerReason: `Price S$${scrape.price.toFixed(2)} below threshold S$${agent.trigger.threshold.toFixed(2)}`,
      scrapeProvider: scrape.source,
    },
    status: "COMPLETED",
    settledAt: new Date().toISOString(),
  };
}
