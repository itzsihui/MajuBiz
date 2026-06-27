import type {
  ActivityEvent,
  Agent,
  DashboardState,
  InventoryItem,
  InventorySettings,
  Transaction,
} from "./types.js";

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
  inventory: [
    {
      id: "inv_bubble_wrap",
      product: "bubble wrap",
      unit: "rolls",
      currentStock: 45,
      reorderThreshold: 20,
      linkedAgentId: "agt_seed",
    },
    {
      id: "inv_carton_boxes",
      product: "carton boxes",
      unit: "boxes",
      currentStock: 120,
      reorderThreshold: 50,
      linkedAgentId: null,
    },
    {
      id: "inv_packing_tape",
      product: "packing tape",
      unit: "rolls",
      currentStock: 18,
      reorderThreshold: 15,
      linkedAgentId: null,
    },
  ],
  inventorySettings: {
    autoSearchEnabled: false,
  },
};

const runEvents = new Map<string, ActivityEvent[]>();
const runSubscribers = new Map<string, Set<(event: ActivityEvent) => void>>();

export function getState(): DashboardState {
  return {
    balance: store.balance,
    currency: store.currency,
    agents: [...store.agents],
    transactions: [...store.transactions],
    inventory: store.inventory.map((item) => ({ ...item })),
    inventorySettings: { ...store.inventorySettings },
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

export function updateInventorySettings(settings: Partial<InventorySettings>): InventorySettings {
  store.inventorySettings = { ...store.inventorySettings, ...settings };
  return { ...store.inventorySettings };
}

export function updateInventoryItem(
  itemId: string,
  patch: Partial<Pick<InventoryItem, "currentStock" | "reorderThreshold" | "linkedAgentId">>
): InventoryItem | null {
  const idx = store.inventory.findIndex((item) => item.id === itemId);
  if (idx < 0) return null;
  store.inventory[idx] = { ...store.inventory[idx], ...patch };
  return { ...store.inventory[idx] };
}

function normalizeProduct(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function productsMatch(a: string, b: string): boolean {
  const na = normalizeProduct(a);
  const nb = normalizeProduct(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}

export function findAgentForInventoryProduct(product: string): Agent | undefined {
  return store.agents.find(
    (a) => productsMatch(a.product, product) && a.status !== "running"
  );
}

export function linkInventoryToAgent(itemId: string, agentId: string): InventoryItem | null {
  return updateInventoryItem(itemId, { linkedAgentId: agentId });
}

function defaultRestockQuantity(item: InventoryItem): number {
  return Math.max(item.reorderThreshold, 25);
}

export function createRestockAgentForInventory(item: InventoryItem): Agent {
  const quantity = defaultRestockQuantity(item);
  const agent: Agent = {
    agentId: `agt_${crypto.randomUUID().slice(0, 8)}`,
    name: `${item.product.replace(/\b\w/g, (c) => c.toUpperCase())} Restock Agent`,
    product: item.product,
    quantity,
    unit: item.unit,
    trigger: { type: "price_below", threshold: 15, currency: "SGD" },
    action: "auto_purchase",
    status: "ready",
    prompt: `Auto-restock ${item.product} when inventory drops to ${item.reorderThreshold} ${item.unit} or below. Buy ${quantity} ${item.unit} if total price is under $15.`,
    createdAt: new Date().toISOString(),
  };
  addAgent(agent);
  linkInventoryToAgent(item.id, agent.agentId);
  return agent;
}

/** Find, match, or spawn a buyer agent for inventory auto-restock */
export function resolveRestockAgent(item: InventoryItem): {
  agent: Agent;
  autoLinked: boolean;
  created: boolean;
} {
  if (item.linkedAgentId) {
    const linked = store.agents.find((a) => a.agentId === item.linkedAgentId);
    if (linked) return { agent: linked, autoLinked: false, created: false };
  }

  const matched = findAgentForInventoryProduct(item.product);
  if (matched) {
    linkInventoryToAgent(item.id, matched.agentId);
    return { agent: matched, autoLinked: true, created: false };
  }

  const created = createRestockAgentForInventory(item);
  return { agent: created, autoLinked: true, created: true };
}

export function getInventoryItem(itemId: string): InventoryItem | undefined {
  return store.inventory.find((item) => item.id === itemId);
}

export function restockByAgent(agentId: string, quantity: number): void {
  const agent = store.agents.find((a) => a.agentId === agentId);
  const item =
    store.inventory.find((i) => i.linkedAgentId === agentId) ??
    (agent ? store.inventory.find((i) => productsMatch(i.product, agent.product)) : undefined);
  if (item) {
    item.currentStock += quantity;
    if (!item.linkedAgentId) {
      item.linkedAgentId = agentId;
    }
  }
}
