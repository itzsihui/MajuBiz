import { v4 as uuidv4 } from "uuid";
import type { ActivityEvent, Agent, Transaction } from "../types.js";
import {
  addTransaction,
  deductBalance,
  emitRunEvent,
  clearRun,
  updateAgent,
} from "../store.js";
import { scrapePrice } from "./exaScrape.js";
import { buildPayNowSettlement } from "./paynowSettlement.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function event(
  runId: string,
  step: string,
  message: string,
  status: ActivityEvent["status"],
  data?: unknown
): ActivityEvent {
  return {
    runId,
    step,
    message,
    status,
    data,
    timestamp: new Date().toISOString(),
  };
}

export async function runAgent(agent: Agent, runId: string): Promise<void> {
  updateAgent(agent.agentId, { status: "running" });

  try {
    emitRunEvent(
      runId,
      event(runId, "start", "Agent run started", "running")
    );
    await delay(400);

    emitRunEvent(
      runId,
      event(runId, "scrape", "Searching Singapore web via Exa...", "running")
    );

    const scrape = await scrapePrice(agent);

    emitRunEvent(
      runId,
      event(
        runId,
        "scrape_done",
        scrape.source === "exa"
          ? `Exa found S$${scrape.price.toFixed(2)} — ${scrape.supplier}`
          : `Demo fallback S$${scrape.price.toFixed(2)} — set EXA_API_KEY for live listings`,
        "done",
        scrape
      )
    );

    if (scrape.source === "exa" && scrape.url) {
      emitRunEvent(
        runId,
        event(runId, "source_url", scrape.url, "done", { url: scrape.url })
      );
    }
    await delay(500);

    if (!scrape.matched) {
      emitRunEvent(
        runId,
        event(
          runId,
          "no_match",
          `Price S$${scrape.price.toFixed(2)} is above threshold S$${agent.trigger.threshold.toFixed(2)} — no purchase`,
          "done",
          scrape
        )
      );
      updateAgent(agent.agentId, { status: "ready" });
      return;
    }

    emitRunEvent(
      runId,
      event(runId, "settle", "Generating PayNow Gen 2 settlement...", "running")
    );
    await delay(600);

    const paynow = buildPayNowSettlement(agent, scrape);
    deductBalance(scrape.price);

    const tx: Transaction = {
      id: uuidv4(),
      agentId: agent.agentId,
      agentName: agent.name,
      description: `${agent.product} restock`,
      amount: scrape.price,
      currency: "SGD",
      status: "completed",
      source: scrape.source,
      url: scrape.url,
      paynowPayload: paynow,
      createdAt: new Date().toISOString(),
    };
    addTransaction(tx);

    emitRunEvent(
      runId,
      event(
        runId,
        "complete",
        `Completed: ${agent.product} restock — S$${scrape.price.toFixed(2)}`,
        "done",
        { scrape, paynow, transaction: tx }
      )
    );

    updateAgent(agent.agentId, { status: "ready" });
  } catch (err) {
    emitRunEvent(
      runId,
      event(
        runId,
        "error",
        err instanceof Error ? err.message : "Agent run failed",
        "error"
      )
    );
    updateAgent(agent.agentId, { status: "ready" });
  } finally {
    clearRun(runId);
  }
}
