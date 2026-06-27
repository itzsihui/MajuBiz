import type { ActivityEvent, Agent, DashboardState, Transaction } from "./types.js";

const INITIAL_BALANCE = 500;

export const store: DashboardState = {
  balance: INITIAL_BALANCE,
  currency: "SGD",
  agents: [
    {
      agentId: "agt_seed",
      name: "Bubble Wrap Restock Agent",
      product: "bubble wrap",
      quantity: 50,
      unit: "rolls",
      trigger: { type: "price_below", threshold: 10, currency: "SGD" },
      action: "auto_purchase",
      status: "ready",
      prompt:
        "Monitor wholesale prices for bubble wrap and automatically purchase 50 rolls when the price drops below $10.",
      createdAt: new Date().toISOString(),
    },
  ],
  transactions: [],
};

const runEvents = new Map<string, ActivityEvent[]>();
const runSubscribers = new Map<string, Set<(event: ActivityEvent) => void>>();

export function getState(): DashboardState {
  return {
    balance: store.balance,
    currency: store.currency,
    agents: [...store.agents],
    transactions: [...store.transactions],
  };
}

export function addAgent(agent: Agent): void {
  store.agents.unshift(agent);
}

export function updateAgent(agentId: string, patch: Partial<Agent>): void {
  const idx = store.agents.findIndex((a) => a.agentId === agentId);
  if (idx >= 0) store.agents[idx] = { ...store.agents[idx], ...patch };
}

export function addTransaction(tx: Transaction): void {
  store.transactions.unshift(tx);
}

export function deductBalance(amount: number): void {
  store.balance = Math.round((store.balance - amount) * 100) / 100;
}

export function emitRunEvent(runId: string, event: ActivityEvent): void {
  const list = runEvents.get(runId) ?? [];
  list.push(event);
  runEvents.set(runId, list);
  runSubscribers.get(runId)?.forEach((cb) => cb(event));
}

export function subscribeRun(runId: string, cb: (event: ActivityEvent) => void): () => void {
  const subs = runSubscribers.get(runId) ?? new Set();
  subs.add(cb);
  runSubscribers.set(runId, subs);
  return () => {
    subs.delete(cb);
    if (subs.size === 0) runSubscribers.delete(runId);
  };
}

export function getRunEvents(runId: string): ActivityEvent[] {
  return runEvents.get(runId) ?? [];
}

export function clearRun(runId: string): void {
  setTimeout(() => {
    runEvents.delete(runId);
    runSubscribers.delete(runId);
  }, 60_000);
}
