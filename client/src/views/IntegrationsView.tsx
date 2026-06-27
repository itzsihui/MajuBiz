import { Check, ChevronDown, Loader2, Lock, MessageSquare, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Agent } from "../lib/api";
import { parseAgent, runAgent } from "../lib/api";
import {
  clearSlackChat,
  loadSlackChat,
  saveSlackChat,
  type StoredChatMessage,
} from "../lib/slackChatStorage";

type ChatMessage = StoredChatMessage;
type IntegrationId = "slack" | "whatsapp" | "telegram" | "hubspot" | "xero";

const SLACK_CONNECTED_KEY = "majubiz_slack_connected";

const QUICK_PROMPTS = [
  "We're low on bubble wrap — buy 50 rolls under $10",
  "Monitor carton boxes and buy 100 when under $15",
  "Get 20 rolls packing tape when price drops below $8",
];

interface IntegrationDef {
  id: IntegrationId;
  name: string;
  subtitle: string;
  description: string;
  available: boolean;
  brand: string;
  icon: React.ReactNode;
}

const INTEGRATIONS: IntegrationDef[] = [
  {
    id: "slack",
    name: "Slack",
    subtitle: "@MajuBiz · #restock-alerts",
    description: "Message the bot to create purchasing agents — same flow as the dashboard.",
    available: true,
    brand: "#4A154B",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
        <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" />
      </svg>
    ),
  },
  {
    id: "whatsapp",
    name: "WhatsApp Business",
    subtitle: "MajuBiz bot · restock alerts",
    description: "Heartland shops get restock intents via WhatsApp — huge for SG SMEs.",
    available: false,
    brand: "#25D366",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.883 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
      </svg>
    ),
  },
  {
    id: "telegram",
    name: "Telegram",
    subtitle: "@MajuBizBot",
    description: "Lightweight bot for staff to trigger restock agents on the go.",
    available: false,
    brand: "#26A5E4",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
        <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
      </svg>
    ),
  },
  {
    id: "hubspot",
    name: "HubSpot CRM",
    subtitle: "Deal won → auto-restock",
    description: "When a deal closes, spin up packaging restock agents automatically.",
    available: false,
    brand: "#FF7A59",
    icon: <span className="text-xs font-bold">HS</span>,
  },
  {
    id: "xero",
    name: "Xero",
    subtitle: "Reconcile PayNow settlements",
    description: "Sync agent purchases and PayNow receipts to your books.",
    available: false,
    brand: "#13B5EA",
    icon: <span className="text-xs font-bold">Xe</span>,
  },
];

interface IntegrationsViewProps {
  onAgentCreated: (agent: Agent) => void;
  onAgentRun: (agent: Agent, runId: string) => void;
  onGoToDashboard: () => void;
  onToast: (message: string, kind?: "success" | "error" | "info" | "warning") => void;
}

function formatThreshold(agent: Agent): string {
  const raw = agent.trigger?.threshold;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? parseFloat(raw) : NaN;
  return Number.isFinite(n) ? n.toFixed(2) : "10.00";
}

function formatAgentReply(agent: Agent): string {
  return `✓ Agent created: ${agent.name}\n• ${agent.quantity} ${agent.unit} of ${agent.product}\n• Buy when ≤ S$${formatThreshold(agent)}\n\nIt's live on your dashboard. Run the search now?`;
}

function newMessage(
  role: ChatMessage["role"],
  text: string,
  extra?: Partial<ChatMessage>
): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    createdAt: new Date().toISOString(),
    text,
    ...extra,
  };
}

function loadSlackConnected(): boolean {
  try {
    return localStorage.getItem(SLACK_CONNECTED_KEY) === "1";
  } catch {
    return false;
  }
}

function saveSlackConnected(connected: boolean): void {
  try {
    localStorage.setItem(SLACK_CONNECTED_KEY, connected ? "1" : "0");
  } catch {
    /* private mode */
  }
}

export function IntegrationsView({
  onAgentCreated,
  onAgentRun,
  onGoToDashboard,
  onToast,
}: IntegrationsViewProps) {
  const [slackConnected, setSlackConnected] = useState(loadSlackConnected);
  const [connectingId, setConnectingId] = useState<IntegrationId | null>(null);
  const [chatOpen, setChatOpen] = useState(loadSlackConnected);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [runningAgentId, setRunningAgentId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadSlackChat());
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    saveSlackChat(messages);
  }, [messages]);

  useEffect(() => {
    if (chatOpen) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages, loading, chatOpen]);

  const pushMessage = (msg: ChatMessage) => setMessages((prev) => [...prev, msg]);

  const pushBot = (text: string, extra?: Partial<ChatMessage>) => {
    pushMessage(newMessage("bot", text, { source: "slack", ...extra }));
  };

  const handleConnect = async (id: IntegrationId) => {
    const def = INTEGRATIONS.find((i) => i.id === id);
    if (!def?.available) return;

    setConnectingId(id);
    await delay(900);
    setSlackConnected(true);
    saveSlackConnected(true);
    setConnectingId(null);
    setChatOpen(true);
    onToast(`${def.name} connected — open the chat to create agents`, "success");
  };

  const handleDisconnect = () => {
    setSlackConnected(false);
    saveSlackConnected(false);
    setChatOpen(false);
    onToast("Slack disconnected", "info");
  };

  const handleSlackRowClick = () => {
    if (!slackConnected) return;
    setChatOpen((open) => !open);
  };

  const handleSend = async (text?: string) => {
    const prompt = (text ?? input).trim();
    if (!prompt || loading || !slackConnected) return;

    setInput("");
    pushMessage(newMessage("user", prompt, { source: "slack" }));
    setLoading(true);

    try {
      const result = await parseAgent(prompt);
      const agent = result.agent;
      onAgentCreated(agent);
      pushBot(formatAgentReply(agent), { agent });
      onToast(`Slack → Dashboard: ${agent.name} created`, "success");
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Unknown error";
      const hint =
        detail.includes("server") || detail.includes("Failed to fetch")
          ? "Can't reach the API — make sure the server is running on port 3001."
          : "Try something like: buy 50 rolls bubble wrap under $10";
      pushBot(`Hmm, that didn't work (${detail}). ${hint}`);
      onToast(detail, "error");
    } finally {
      setLoading(false);
    }
  };

  const handleRun = async (agent: Agent, msgId: string) => {
    if (runningAgentId) return;
    setRunningAgentId(agent.agentId);
    try {
      const { runId } = await runAgent(agent.agentId);
      setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, runId } : m)));
      pushBot(`Searching Shopee & Carousell for *${agent.product}*… Check Dashboard for live progress.`);
      onAgentRun(agent, runId);
      onToast(`${agent.name} running — switched to live search`, "info");
    } catch {
      pushBot("Couldn't start the agent run. It may already be running.");
      onToast("Failed to run agent", "error");
    } finally {
      setRunningAgentId(null);
    }
  };

  const handleClearChat = () => {
    if (!window.confirm("Clear #restock-alerts history? This only resets the demo chat.")) return;
    setMessages(clearSlackChat());
    onToast("Slack chat cleared", "info");
  };

  const connectedCount = slackConnected ? 1 : 0;

  return (
    <main className="flex-1 overflow-auto p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-brand-600">
              {connectedCount} connected · {INTEGRATIONS.length - 1} coming soon
            </p>
            <h2 className="mt-1 text-lg font-semibold text-slate-900">Channels</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Connect where your team works — intents become agents on the dashboard.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          {INTEGRATIONS.map((def) => {
            const isSlack = def.id === "slack";
            const isConnected = isSlack && slackConnected;
            const isConnecting = connectingId === def.id;
            const isExpanded = isSlack && chatOpen && slackConnected;

            return (
              <div key={def.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div
                  role={isSlack && slackConnected ? "button" : undefined}
                  tabIndex={isSlack && slackConnected ? 0 : undefined}
                  onClick={isSlack ? handleSlackRowClick : undefined}
                  onKeyDown={
                    isSlack && slackConnected
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handleSlackRowClick();
                          }
                        }
                      : undefined
                  }
                  className={`flex items-center gap-4 p-4 transition ${
                    !def.available ? "opacity-70" : ""
                  } ${isSlack && slackConnected ? "cursor-pointer hover:bg-slate-50/80" : ""} ${
                    isExpanded ? "border-b border-slate-100 bg-slate-50/50" : ""
                  }`}
                >
                  <div
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white shadow-sm"
                    style={{ backgroundColor: def.brand }}
                  >
                    {def.icon}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-slate-900">{def.name}</h3>
                      {!def.available && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                          <Lock className="h-2.5 w-2.5" />
                          Coming soon
                        </span>
                      )}
                      {isConnected && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 ring-1 ring-emerald-600/15">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          Connected
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500">{def.subtitle}</p>
                    <p className="mt-1 hidden text-sm text-slate-600 sm:block">{def.description}</p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    {def.available ? (
                      isConnected ? (
                        <>
                          <button
                            type="button"
                            onClick={handleSlackRowClick}
                            className="hidden items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-white sm:inline-flex"
                          >
                            {isExpanded ? "Hide chat" : "Open chat"}
                            <ChevronDown
                              className={`h-3.5 w-3.5 transition ${isExpanded ? "rotate-180" : ""}`}
                            />
                          </button>
                          <button
                            type="button"
                            onClick={handleDisconnect}
                            className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                          >
                            Disconnect
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void handleConnect(def.id)}
                          disabled={!!connectingId}
                          className="inline-flex min-w-[100px] items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium text-white shadow-sm disabled:opacity-60"
                          style={{ backgroundColor: def.brand }}
                        >
                          {isConnecting ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Connecting…
                            </>
                          ) : (
                            "Connect"
                          )}
                        </button>
                      )
                    ) : (
                      <button
                        type="button"
                        disabled
                        className="cursor-not-allowed rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-400"
                      >
                        Connect
                      </button>
                    )}
                  </div>
                </div>

                {isExpanded && (
                  <div className="transition-all duration-200">
                    <div className="flex items-center gap-2 border-b border-slate-100 bg-[#350d36] px-4 py-2.5 text-white">
                      <MessageSquare className="h-3.5 w-3.5" />
                      <span className="text-xs font-medium"># restock-alerts</span>
                      <span className="text-[11px] text-white/50">· MajuBiz workspace</span>
                      <button
                        type="button"
                        onClick={handleClearChat}
                        className="ml-auto text-[11px] text-white/45 hover:text-white/90"
                      >
                        Clear
                      </button>
                      <button
                        type="button"
                        onClick={() => setChatOpen(false)}
                        className="rounded p-0.5 text-white/45 hover:bg-white/10 hover:text-white"
                        aria-label="Close chat"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <div className="flex h-[400px] flex-col bg-[#f8f8f8]">
                      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
                        {messages.map((msg) => (
                          <div
                            key={msg.id}
                            className={`flex gap-2.5 ${
                              msg.role === "user" ? "flex-row-reverse" : ""
                            }`}
                          >
                            <div
                              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold text-white ${
                                msg.role === "user" ? "bg-brand-600" : "bg-[#4A154B]"
                              }`}
                            >
                              {msg.role === "user" ? "You" : "MB"}
                            </div>
                            <div className={`max-w-[80%] ${msg.role === "user" ? "text-right" : ""}`}>
                              <div
                                className={`inline-block rounded-2xl px-3 py-2 text-sm ${
                                  msg.role === "user"
                                    ? "rounded-tr-sm bg-brand-600 text-white"
                                    : "rounded-tl-sm border border-slate-200 bg-white text-slate-800 shadow-sm"
                                }`}
                              >
                                <p className="whitespace-pre-wrap">{msg.text.replace(/\*/g, "")}</p>
                              </div>
                              {msg.agent && !msg.runId && msg.role === "bot" && (
                                <div className="mt-2 flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    disabled={!!runningAgentId}
                                    onClick={() => handleRun(msg.agent!, msg.id)}
                                    className="rounded-lg bg-[#007a5a] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#006b4f] disabled:opacity-50"
                                  >
                                    {runningAgentId === msg.agent.agentId ? (
                                      <span className="inline-flex items-center gap-1">
                                        <Loader2 className="h-3 w-3 animate-spin" /> Running…
                                      </span>
                                    ) : (
                                      "Run search now"
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={onGoToDashboard}
                                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                                  >
                                    Dashboard →
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                        {loading && (
                          <div className="flex items-center gap-2 pl-9 text-xs text-slate-400">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            MajuBiz is thinking…
                          </div>
                        )}
                      </div>

                      <div className="border-t border-slate-200 bg-white p-3">
                        <div className="mb-2 flex flex-wrap gap-1.5">
                          {QUICK_PROMPTS.map((q) => (
                            <button
                              key={q}
                              type="button"
                              disabled={loading}
                              onClick={() => void handleSend(q)}
                              className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] text-slate-600 hover:border-[#4A154B]/30 hover:bg-purple-50 disabled:opacity-40"
                            >
                              {q.length > 36 ? `${q.slice(0, 36)}…` : q}
                            </button>
                          ))}
                        </div>
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            void handleSend();
                          }}
                          className="flex gap-2"
                        >
                          <input
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            disabled={loading}
                            placeholder="Message @MajuBiz…"
                            className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-[#4A154B]/40 focus:bg-white focus:ring-2 focus:ring-purple-100"
                          />
                          <button
                            type="submit"
                            disabled={loading || !input.trim()}
                            className="flex items-center justify-center rounded-xl bg-[#4A154B] px-3.5 py-2 text-white hover:bg-[#350d36] disabled:opacity-40"
                          >
                            <Send className="h-4 w-4" />
                          </button>
                        </form>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {slackConnected && !chatOpen && (
          <button
            type="button"
            onClick={() => setChatOpen(true)}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-[#4A154B]/30 bg-purple-50/50 py-3 text-sm font-medium text-[#4A154B] hover:bg-purple-50"
          >
            <MessageSquare className="h-4 w-4" />
            Open Slack chat — #restock-alerts
          </button>
        )}

        {!slackConnected && (
          <p className="text-center text-xs text-slate-400">
            Connect Slack to message @MajuBiz and spin up agents from chat.
          </p>
        )}

        {slackConnected && (
          <div className="flex items-center justify-center gap-2 text-xs text-emerald-600">
            <Check className="h-3.5 w-3.5" />
            Slack connected — agents created here appear on Dashboard instantly
          </div>
        )}
      </div>
    </main>
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
