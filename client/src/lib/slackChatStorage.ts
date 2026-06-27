import type { Agent } from "./api";

export interface StoredChatMessage {
  id: string;
  role: "user" | "bot" | "system";
  source?: "slack" | "hubspot";
  text: string;
  agent?: Agent;
  runId?: string;
  createdAt: string;
}

const STORAGE_KEY = "majubiz_slack_chat";

export const WELCOME_MESSAGE: StoredChatMessage = {
  id: "welcome",
  role: "bot",
  source: "slack",
  text: 'Hi! I\'m MajuBiz. Tell me what to restock or monitor — e.g. "buy 50 rolls bubble wrap under $10". I\'ll spin up an agent on your dashboard.',
  createdAt: new Date(0).toISOString(),
};

export function loadSlackChat(): StoredChatMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [WELCOME_MESSAGE];
    const parsed = JSON.parse(raw) as StoredChatMessage[];
    if (!Array.isArray(parsed) || parsed.length === 0) return [WELCOME_MESSAGE];
    return slimMessages(parsed);
  } catch {
    return [WELCOME_MESSAGE];
  }
}

/** Persist slim agent snapshots so localStorage never corrupts trigger fields. */
function slimMessages(messages: StoredChatMessage[]): StoredChatMessage[] {
  return messages.map((m) => {
    if (!m.agent) return m;
    const threshold = Number(m.agent.trigger?.threshold);
    return {
      ...m,
      agent: {
        agentId: m.agent.agentId,
        name: m.agent.name,
        product: m.agent.product,
        quantity: m.agent.quantity,
        unit: m.agent.unit,
        trigger: {
          type: "price_below",
          threshold: Number.isFinite(threshold) ? threshold : 10,
          currency: "SGD",
        },
        action: "auto_purchase",
        status: m.agent.status ?? "ready",
        prompt: m.agent.prompt ?? "",
        createdAt: m.agent.createdAt ?? new Date().toISOString(),
      },
    };
  });
}

export function saveSlackChat(messages: StoredChatMessage[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slimMessages(messages)));
  } catch {
    /* quota / private mode */
  }
}

export function clearSlackChat(): StoredChatMessage[] {
  const fresh = [WELCOME_MESSAGE];
  saveSlackChat(fresh);
  return fresh;
}
