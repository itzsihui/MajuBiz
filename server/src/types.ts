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

export interface ScrapeResult {
  source: "exa" | "exa-cached" | "fallback" | "seller-agent" | "shopee-open";
  supplier: string;
  product: string;
  /** Total estimated cost for agent.quantity */
  price: number;
  currency: "SGD";
  url: string;
  matched: boolean;
  relevant?: boolean;
  relevanceReason?: string;
  listingPrice?: number;
  packQuantity?: number;
  packsNeeded?: number;
  priceDetail?: string;
  highlights?: string[];
  isCheapestPick?: boolean;
  thoughtProcess?: string[];
  priceComparisons?: Array<{
    title: string;
    total: number;
    relevant: boolean;
    url: string;
    selected: boolean;
  }>;
  imageUrl?: string;
  sellerName?: string;
  sellerAgentId?: string;
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

export interface ActivityEvent {
  runId: string;
  step: string;
  message: string;
  status: "pending" | "running" | "done" | "error";
  data?: unknown;
  timestamp: string;
}

export interface ParsedAgentConfig {
  name: string;
  product: string;
  quantity: number;
  unit: string;
  trigger: AgentTrigger;
}

export interface InventoryItem {
  id: string;
  product: string;
  unit: string;
  currentStock: number;
  reorderThreshold: number;
  /** Max acceptable price per unit (e.g. S$5/box). Total budget = restock qty × this. */
  maxUnitPrice: number;
  linkedAgentId: string | null;
}

export interface InventorySettings {
  autoSearchEnabled: boolean;
}

export interface DashboardState {
  balance: number;
  currency: "SGD";
  agents: Agent[];
  transactions: Transaction[];
  inventory: InventoryItem[];
  inventorySettings: InventorySettings;
}
