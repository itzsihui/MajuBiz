import { v4 as uuidv4 } from "uuid";
import type { ActivityEvent, Agent, Transaction } from "../types.js";
import {
  addTransaction,
  deductBalance,
  emitRunEvent,
  clearRun,
  restockByAgent,
  updateAgent,
} from "../store.js";
import { scrapePrice, formatScrapeMessage } from "./exaScrape.js";
import { buildPayNowSettlement } from "./paynowSettlement.js";
import { buildProposal, waitForRunApproval } from "./runApproval.js";

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

function formatMoney(n: number) {
  return `S$${n.toFixed(2)}`;
}

export async function runAgent(agent: Agent, runId: string): Promise<void> {
  updateAgent(agent.agentId, { status: "running" });

  try {
    emitRunEvent(runId, event(runId, "start", "Agent run started", "running"));
    await delay(400);

    const scrapeProgress: string[] = [];
    const emitScrapeProgress = (line: string) => {
      scrapeProgress.push(line);
      emitRunEvent(
        runId,
        event(runId, "scrape", line, "running", { progress: [...scrapeProgress] })
      );
    };

    emitScrapeProgress("Searching Singapore web via Exa…");

    const { scrape, brain } = await scrapePrice(agent, emitScrapeProgress);

    emitRunEvent(
      runId,
      event(runId, "scrape", scrapeProgress.at(-1) ?? "Search complete", "done", {
        progress: scrapeProgress,
      })
    );

    emitRunEvent(
      runId,
      event(runId, "reasoning", "Agent Brain — thinking through options…", "done", {
        thoughts: brain.thoughts,
      })
    );

    const compareLines =
      scrape.priceComparisons
        ?.filter((c) => c.relevant)
        .sort((a, b) => a.total - b.total)
        .map(
          (c, i) =>
            `${i === 0 && c.selected ? "★ " : "  "}${formatMoney(c.total)} — ${c.title}${c.selected ? " (selected)" : ""}`
        ) ?? [];

    emitRunEvent(
      runId,
      event(
        runId,
        "compare",
        compareLines.length
          ? `Price comparison (${compareLines.length} relevant):\n${compareLines.join("\n")}`
          : brain.summary,
        "done",
        { comparisons: scrape.priceComparisons, summary: brain.summary }
      )
    );

    emitRunEvent(
      runId,
      event(runId, "scrape_done", formatScrapeMessage(scrape), "done", scrape)
    );
    await delay(400);

    if (!scrape.matched) {
      emitRunEvent(runId, event(runId, "no_match", brain.summary, "done", scrape));
      updateAgent(agent.agentId, { status: "ready" });
      return;
    }

    const proposal = buildProposal(agent, scrape, brain);
    emitRunEvent(
      runId,
      event(
        runId,
        "approval",
        "Agent found a match — waiting for your approval",
        "running",
        { proposal }
      )
    );

    const approved = await waitForRunApproval(runId, agent, scrape, brain);

    if (!approved) {
      emitRunEvent(
        runId,
        event(runId, "rejected", "Purchase declined — no payment sent", "done", { proposal, scrape })
      );
      updateAgent(agent.agentId, { status: "ready" });
      return;
    }

    emitRunEvent(
      runId,
      event(runId, "approval", "Approved — proceeding to PayNow", "done", { proposal, approved: true })
    );

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
    restockByAgent(agent.agentId, agent.quantity);

    emitRunEvent(
      runId,
      event(
        runId,
        "complete",
        `Completed: ${agent.product} — S$${scrape.price.toFixed(2)} (cheapest relevant match)`,
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
