export interface AgentTrigger {
  type: "price_below";
  threshold: number;
  currency: "SGD";
}

export interface Agent {
  agentId: string;
  name: string;
  product: string;
  quantity: number;
  unit: string;
  trigger: AgentTrigger;
  action: "auto_purchase";
  status: "ready" | "running" | "completed";
  prompt: string;
  createdAt: string;
}

export interface PayNowPayload {
  scheme: string;
  messageType: string;
  transactionRef: string;
  amount: { value: number; currency: string };
  creditor: { name: string; uen: string; proxyType: string };
  structuredRemittance: {
    invoiceNumber: string;
    lineItems: Array<{
      description: string;
      quantity: number;
      unit: string;
      unitPrice: number;
    }>;
    reconciliationRef: string;
    categoryCode: string;
  };
  agentMetadata: {
    platform: string;
    agentId: string;
    triggerReason: string;
    scrapeProvider: string;
  };
  status: string;
  settledAt: string;
}

export interface Transaction {
  id: string;
  agentId: string;
  agentName: string;
  description: string;
  amount: number;
  currency: "SGD";
  status: "completed" | "pending";
  source: string;
  url?: string;
  paynowPayload?: PayNowPayload;
  createdAt: string;
}

export interface DashboardState {
  balance: number;
  currency: "SGD";
  agents: Agent[];
  transactions: Transaction[];
  inventory: InventoryItem[];
  inventorySettings: InventorySettings;
}

export interface InventoryItem {
  id: string;
  product: string;
  unit: string;
  currentStock: number;
  reorderThreshold: number;
  maxUnitPrice: number;
  linkedAgentId: string | null;
}

export interface InventorySettings {
  autoSearchEnabled: boolean;
}

export interface UpdateInventoryResult {
  item: InventoryItem;
  triggered: boolean;
  lowStock: boolean;
  runId?: string;
  agentId?: string;
  agentName?: string;
  agent?: Agent;
  autoLinked?: boolean;
  agentCreated?: boolean;
  message?: string;
}

export interface ActivityEvent {
  runId: string;
  step: string;
  message: string;
  status: "pending" | "running" | "done" | "error";
  data?: unknown;
  timestamp: string;
}

export interface PurchaseProposal {
  agentId: string;
  agentName: string;
  product: string;
  quantity: number;
  unit: string;
  title: string;
  url: string;
  totalPrice: number;
  priceDetail: string;
  listingPrice: number;
  brainSummary: string;
  thoughts: string[];
  verdictReason?: string;
  imageUrl?: string;
  sellerName?: string;
  source?: string;
}

const API_BASE = import.meta.env.VITE_API_URL ?? "";

export async function fetchState(): Promise<DashboardState> {
  const res = await fetch(`${API_BASE}/api/state`);
  if (!res.ok) throw new Error("Failed to load state");
  return res.json();
}

export async function parseAgent(prompt: string) {
  const res = await fetch(`${API_BASE}/api/agents/parse`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) throw new Error("Failed to create agent");
  return res.json();
}

export async function runAgent(agentId: string): Promise<{ runId: string }> {
  const res = await fetch(`${API_BASE}/api/agents/${agentId}/run`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Failed to start agent run");
  return res.json();
}

export async function deleteAgent(agentId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/agents/${agentId}`, { method: "DELETE" });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? "Failed to delete agent");
  }
}

export async function approveRun(runId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/runs/${runId}/approve`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to approve purchase");
}

export async function rejectRun(runId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/runs/${runId}/reject`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to reject purchase");
}

export function subscribeRunEvents(
  agentId: string,
  runId: string,
  onEvent: (event: ActivityEvent) => void
): () => void {
  const source = new EventSource(
    `${API_BASE}/api/agents/${agentId}/events?runId=${encodeURIComponent(runId)}`
  );

  source.onmessage = (msg) => {
    const event = JSON.parse(msg.data) as ActivityEvent;
    if (event.step === "stream_end") {
      source.close();
      return;
    }
    onEvent(event);
  };

  source.onerror = () => source.close();
  return () => source.close();
}

export async function updateInventorySettings(autoSearchEnabled: boolean): Promise<InventorySettings> {
  const res = await fetch(`${API_BASE}/api/inventory/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ autoSearchEnabled }),
  });
  if (!res.ok) throw new Error("Failed to update inventory settings");
  const data = await res.json();
  return data.settings;
}

export async function saveInventoryItem(
  itemId: string,
  patch: { currentStock?: number; reorderThreshold?: number; maxUnitPrice?: number }
): Promise<UpdateInventoryResult> {
  const res = await fetch(`${API_BASE}/api/inventory/${itemId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error("Failed to save inventory");
  return res.json();
}
