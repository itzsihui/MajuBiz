import type { ActivityEvent, Agent, PayNowPayload, ScrapeResult } from "../types.js";
import { buildPayNowSettlement } from "./paynowSettlement.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type SettlementPhase = "SUBMITTED" | "VALIDATED" | "SENT" | "COMPLETED";

export interface SettlementProgressData {
  settlementId: string;
  phase: SettlementPhase;
  progress: string[];
  paynow: PayNowPayload;
}

function settlementEvent(
  runId: string,
  status: ActivityEvent["status"],
  phase: SettlementPhase,
  progress: string[],
  settlementId: string,
  paynow: PayNowPayload
): ActivityEvent {
  return {
    runId,
    step: "settle",
    message: progress[progress.length - 1] ?? phase,
    status,
    data: { settlementId, phase, progress, paynow } satisfies SettlementProgressData,
    timestamp: new Date().toISOString(),
  };
}

/** Simulates PayNow Gen 2 submit → validate → send → complete with realistic delays */
export async function runSettlementSimulation(
  runId: string,
  agent: Agent,
  scrape: ScrapeResult,
  emit: (event: ActivityEvent) => void
): Promise<PayNowPayload> {
  const settlementId = buildPayNowSettlement(agent, scrape).transactionRef;
  const progress: string[] = [];

  const base = buildPayNowSettlement(agent, scrape);

  progress.push("SUBMITTED — PayNow request queued on network");
  emit(
    settlementEvent(
      runId,
      "running",
      "SUBMITTED",
      progress,
      settlementId,
      { ...base, status: "SUBMITTED", settledAt: "" }
    )
  );
  await delay(700);

  progress.push("VALIDATED — UEN, amount & structured remittance verified");
  emit(
    settlementEvent(
      runId,
      "running",
      "VALIDATED",
      progress,
      settlementId,
      { ...base, status: "VALIDATED", settledAt: "" }
    )
  );
  await delay(650);

  progress.push(`SENT — S$${base.amount.value.toFixed(2)} released to ${base.creditor.name}`);
  emit(
    settlementEvent(
      runId,
      "running",
      "SENT",
      progress,
      settlementId,
      { ...base, status: "SENT", settledAt: "" }
    )
  );
  await delay(800);

  const completed: PayNowPayload = {
    ...base,
    status: "COMPLETED",
    settledAt: new Date().toISOString(),
  };

  progress.push(`COMPLETED — Ref ${settlementId} · reconciled`);
  emit(settlementEvent(runId, "done", "COMPLETED", progress, settlementId, completed));

  return completed;
}

export function buildPayNowPreview(agent: Agent, scrape: ScrapeResult) {
  const payload = buildPayNowSettlement(agent, scrape);
  return {
    settlementId: payload.transactionRef,
    creditorName: payload.creditor.name,
    creditorUen: payload.creditor.uen,
    amount: payload.amount.value,
    currency: payload.amount.currency,
    reconciliationRef: payload.structuredRemittance.reconciliationRef,
    invoiceNumber: payload.structuredRemittance.invoiceNumber,
    product: agent.product,
    quantity: agent.quantity,
    unit: agent.unit,
    lineItems: payload.structuredRemittance.lineItems,
    debtorName: payload.debtor?.businessName,
    shipTo: payload.shipping
      ? [
          payload.shipping.addressLine1,
          payload.shipping.addressLine2,
          `${payload.shipping.city} ${payload.shipping.postalCode}`,
          payload.shipping.country,
        ]
          .filter(Boolean)
          .join(", ")
      : undefined,
  };
}
