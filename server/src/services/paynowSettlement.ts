import type { Agent, PayNowPayload, ScrapeResult } from "../types.js";
import { getBusinessProfile } from "../store.js";
import { getOrCreateSellerAgent } from "./dynamicSellerAgent.js";

function randomRef(): string {
  return `PN2-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export function buildPayNowSettlement(agent: Agent, scrape: ScrapeResult): PayNowPayload {
  const unitPrice = Math.round((scrape.price / agent.quantity) * 100) / 100;
  const sellerAgent = scrape.source === "seller-agent" ? getOrCreateSellerAgent(agent) : undefined;
  const creditorName = scrape.sellerName ?? scrape.supplier;
  const creditorUen = sellerAgent?.uen ?? "201234567A";
  const profile = getBusinessProfile();

  return {
    scheme: "PayNow-Gen2",
    messageType: "REQUEST_TO_PAY",
    transactionRef: randomRef(),
    amount: { value: scrape.price, currency: "SGD" },
    creditor: {
      name: creditorName,
      uen: creditorUen,
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
    debtor: {
      businessName: profile.businessName,
      uen: profile.uen,
      contactName: profile.contactName,
      contactEmail: profile.contactEmail,
      contactPhone: profile.contactPhone,
    },
    shipping: {
      addressLine1: profile.shippingAddressLine1,
      addressLine2: profile.shippingAddressLine2 || undefined,
      postalCode: profile.postalCode,
      city: profile.city,
      country: profile.country,
    },
    status: "COMPLETED",
    settledAt: new Date().toISOString(),
  };
}
