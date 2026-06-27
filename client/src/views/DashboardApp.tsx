import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Circle,
  Info,
  ListTree,
  Loader2,
  Package,
  Plug,
  Plus,
  Receipt,
  Settings,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { BrandLogo } from "../components/BrandLogo";
import { PayNowBankModal } from "../components/PayNowBankModal";
import { PayNowReceipt } from "../components/PayNowReceipt";
import type { ActivityEvent, Agent, DashboardState, PayNowPayload, PayNowPreview, PurchaseProposal } from "../lib/api";
import {
  approveRun,
  deleteAgent as deleteAgentApi,
  fetchPayNowPreview,
  fetchState,
  parseAgent,
  rejectRun,
  runAgent as runAgentApi,
  subscribeRunEvents,
} from "../lib/api";
import { formatRunTimestamp, loadAgentRuns, saveAgentRuns } from "../lib/agentRunStorage";
import { IntegrationsView } from "./IntegrationsView";
import { InventoryView } from "./InventoryView";
import { PaymentsView } from "./PaymentsView";
import { SettingsView } from "./SettingsView";
import { Link } from "react-router-dom";

type AppTab = "dashboard" | "inventory" | "payments" | "integrations" | "settings";

const TAB_META: Record<AppTab, { title: string; subtitle: string }> = {
  dashboard: {
    title: "Dashboard",
    subtitle: "Zero-code agentic commerce for Singapore SMEs",
  },
  inventory: {
    title: "Inventory",
    subtitle: "Track stock levels and auto-trigger purchasing agents",
  },
  payments: {
    title: "Payments",
    subtitle: "PayNow Gen 2 settlements and payment history",
  },
  integrations: {
    title: "Integrations",
    subtitle: "Slack, CRM — create agents from where your team already works",
  },
  settings: {
    title: "Settings",
    subtitle: "Business name, contact details, and shipping address for agents",
  },
};

function formatMoney(amount: number) {
  return `S$${amount.toFixed(2)}`;
}

function isSellerAgentProgressLine(line: string): boolean {
  return line.includes("Seller Agent") || line.includes("Live via Exa") || line.startsWith("Exa —");
}

function CommercePipeline({ activeStep }: { activeStep?: "search" | "seller" | "brain" | "pay" }) {
  const steps = [
    { id: "search" as const, label: "Exa search", detail: "Live web" },
    { id: "seller" as const, label: "Seller agent", detail: "JSON quote" },
    { id: "brain" as const, label: "Agent Brain", detail: "Pick best" },
    { id: "pay" as const, label: "PayNow", detail: "Settle" },
  ];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-400">Agent commerce flow</p>
      <div className="flex flex-wrap items-center gap-2">
        {steps.map((step, i) => {
          const isActive = activeStep === step.id;
          return (
            <div key={step.id} className="flex items-center gap-2">
              <div
                className={`rounded-lg px-2.5 py-1.5 text-xs ${
                  isActive
                    ? "bg-brand-50 font-medium text-brand-700 ring-1 ring-brand-200"
                    : "bg-slate-50 text-slate-600"
                }`}
              >
                <div>{step.label}</div>
                <div className="text-[10px] opacity-70">{step.detail}</div>
              </div>
              {i < steps.length - 1 && <span className="text-slate-300">→</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const STEP_ORDER = [
  "log",
  "start",
  "scrape",
  "reasoning",
  "compare",
  "scrape_done",
  "approval",
  "settle",
  "no_match",
  "rejected",
  "complete",
  "error",
] as const;

function stepSortIndex(step: string): number {
  const idx = STEP_ORDER.indexOf(step as (typeof STEP_ORDER)[number]);
  return idx >= 0 ? idx : 99;
}

export interface AgentRunRecord {
  activity: ActivityEvent[];
  summary: string;
  finishedAt: string | null;
}

type ToastKind = "success" | "error" | "info" | "warning";

interface ToastItem {
  id: string;
  message: string;
  kind: ToastKind;
}

function ToastStack({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;

  const styles: Record<ToastKind, { wrap: string; icon: typeof CheckCircle2 }> = {
    success: { wrap: "border-emerald-200 bg-emerald-50 text-emerald-900", icon: CheckCircle2 },
    error: { wrap: "border-red-200 bg-red-50 text-red-900", icon: AlertCircle },
    warning: { wrap: "border-amber-200 bg-amber-50 text-amber-900", icon: AlertCircle },
    info: { wrap: "border-sky-200 bg-sky-50 text-sky-900", icon: Info },
  };

  return (
    <div className="pointer-events-none fixed right-6 top-20 z-50 flex w-full max-w-sm flex-col gap-2">
      {toasts.map((toast) => {
        const style = styles[toast.kind];
        const Icon = style.icon;
        return (
          <button
            key={toast.id}
            type="button"
            onClick={() => onDismiss(toast.id)}
            className={`pointer-events-auto flex items-start gap-3 rounded-2xl border px-4 py-3 text-left text-sm shadow-lg ${style.wrap}`}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1">{toast.message}</span>
            <X className="h-4 w-4 shrink-0 opacity-50" />
          </button>
        );
      })}
    </div>
  );
}

function deriveRunSummary(events: ActivityEvent[]): string {
  const terminal = events.find((e) => ["complete", "no_match", "rejected", "error"].includes(e.step));
  if (terminal) return terminal.message;
  if (events.some((e) => e.status === "running")) return "Running…";
  return "Run in progress…";
}

function dominantRunId(events: ActivityEvent[]): string | null {
  const serverEvents = events.filter((e) => e.runId !== "local");
  return serverEvents.length > 0 ? serverEvents[serverEvents.length - 1]!.runId : null;
}

function scopeActivityToRun(events: ActivityEvent[], runId: string | null): ActivityEvent[] {
  if (!runId) return events;
  return events.filter((e) => e.runId === "local" || e.runId === runId);
}

/** Hide payment steps until the owner approves (guards against stale events from prior runs). */
function activityForDisplay(events: ActivityEvent[], activeRunId: string | null): ActivityEvent[] {
  const runId = activeRunId ?? dominantRunId(events);
  const scoped = scopeActivityToRun(events, runId);
  const awaitingApproval = scoped.some((e) => e.step === "approval" && e.status === "running");
  if (!awaitingApproval) return scoped;
  return scoped.filter((e) => e.step !== "settle" && e.step !== "complete");
}

function mergeActivityEvents(prev: ActivityEvent[], incoming: ActivityEvent): ActivityEvent[] {
  const runId = incoming.runId !== "local" ? incoming.runId : dominantRunId(prev);
  const scoped = scopeActivityToRun(prev, runId);

  const map = new Map(scoped.map((e) => [e.step, e]));
  map.set(incoming.step, incoming);

  const incomingIdx = stepSortIndex(incoming.step);

  for (const [step, event] of map) {
    const idx = stepSortIndex(step);
    if (idx >= 0 && idx < incomingIdx && event.status === "running") {
      map.set(step, { ...event, status: "done" });
    }
  }

  if (["complete", "no_match", "rejected", "error"].includes(incoming.step)) {
    for (const [step, event] of map) {
      if (event.status === "running") {
        map.set(step, { ...event, status: "done" });
      }
    }
  }

  return [...map.values()].sort((a, b) => stepSortIndex(a.step) - stepSortIndex(b.step));
}

function stepLabel(step: string): string {
  const labels: Record<string, string> = {
    log: "Initiate",
    start: "Agent run",
    scrape: "Discovery",
    reasoning: "Agent Brain",
    compare: "Price comparison",
    scrape_done: "Decision",
    approval: "Your approval",
    settle: "PayNow settlement",
    no_match: "No purchase",
    rejected: "Declined",
    complete: "Complete",
    error: "Error",
  };
  return labels[step] ?? step;
}

function ActivityModal({
  open,
  onClose,
  activity,
  activeRunId,
  agentName,
  isRunning,
  pendingApproval,
  onProceedToPay,
  onReject,
  approvalLoading,
}: {
  open: boolean;
  onClose: () => void;
  activity: ActivityEvent[];
  activeRunId: string | null;
  agentName: string | null;
  isRunning: boolean;
  pendingApproval: PurchaseProposal | null;
  onProceedToPay: () => void;
  onReject: () => void;
  approvalLoading: boolean;
}) {
  if (!open) return null;

  const steps = activityForDisplay(activity, isRunning ? activeRunId : null).sort(
    (a, b) => stepSortIndex(a.step) - stepSortIndex(b.step)
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">Activity</h2>
            {agentName && <p className="text-sm text-slate-500">{agentName}</p>}
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {steps.length === 0 ? (
            <p className="text-sm text-slate-400">No activity yet.</p>
          ) : (
            <ol className="space-y-4">
              {steps.map((ev, i) => {
                const isActive = ev.status === "running";
                const isError = ev.status === "error";
                const scrapeData =
                  ev.step === "scrape_done" && ev.data && typeof ev.data === "object"
                    ? (ev.data as { url?: string; priceDetail?: string })
                    : null;
                const reasoningData =
                  ev.step === "reasoning" && ev.data && typeof ev.data === "object"
                    ? (ev.data as { thoughts?: string[] })
                    : null;
                const compareData =
                  ev.step === "compare" && ev.data && typeof ev.data === "object"
                    ? (ev.data as {
                        comparisons?: Array<{
                          title: string;
                          total: number;
                          relevant: boolean;
                          selected: boolean;
                        }>;
                      })
                    : null;
                const scrapeProgress =
                  ev.step === "scrape" && ev.data && typeof ev.data === "object"
                    ? (ev.data as { progress?: string[] }).progress
                    : null;
                const settleProgress =
                  ev.step === "settle" && ev.data && typeof ev.data === "object"
                    ? (ev.data as { progress?: string[] }).progress
                    : null;
                const approvalData =
                  ev.step === "approval" && ev.data && typeof ev.data === "object"
                    ? (ev.data as { proposal?: PurchaseProposal; approved?: boolean })
                    : null;
                const showApprovalCard =
                  ev.step === "approval" &&
                  ev.status === "running" &&
                  (approvalData?.proposal ?? pendingApproval);

                return (
                  <li key={`${ev.step}-${ev.timestamp}`} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      {isActive ? (
                        <Loader2 className="h-5 w-5 animate-spin text-brand-500" />
                      ) : isError ? (
                        <Circle className="h-5 w-5 text-red-400" />
                      ) : (
                        <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                      )}
                      {i < steps.length - 1 && <div className="mt-1 w-px flex-1 bg-slate-200" />}
                    </div>
                    <div className="min-w-0 flex-1 pb-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                        Step {i + 1} · {stepLabel(ev.step)}
                      </p>

                      {showApprovalCard ? (
                        <ApprovalCard
                          proposal={approvalData?.proposal ?? pendingApproval!}
                          onProceedToPay={onProceedToPay}
                          onReject={onReject}
                          loading={approvalLoading}
                        />
                      ) : ev.step === "settle" && settleProgress?.length ? (
                        <ul className="mt-2 space-y-1.5 rounded-xl bg-rose-50 p-3 font-mono text-[11px] leading-relaxed text-rose-950">
                          {settleProgress.map((line, j) => (
                            <li
                              key={j}
                              className={
                                j === settleProgress.length - 1 && isActive ? "font-semibold text-[#c41230]" : ""
                              }
                            >
                              {line}
                            </li>
                          ))}
                        </ul>
                      ) : ev.step === "scrape" && scrapeProgress?.length ? (
                        <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-xl bg-sky-50 p-3 font-mono text-[11px] leading-relaxed text-sky-900">
                          {scrapeProgress.map((line, j) => {
                            const sellerLine = isSellerAgentProgressLine(line);
                            return (
                              <li
                                key={j}
                                className={
                                  j === scrapeProgress.length - 1 && isActive
                                    ? "font-medium"
                                    : sellerLine
                                      ? "text-emerald-800"
                                      : ""
                                }
                              >
                                {line}
                              </li>
                            );
                          })}
                        </ul>
                      ) : ev.step === "reasoning" && reasoningData?.thoughts ? (
                        <ul className="mt-2 space-y-1.5 rounded-xl bg-violet-50 p-3 text-xs text-violet-900">
                          {reasoningData.thoughts.map((t, j) => (
                            <li key={j} className="flex gap-2">
                              <span className="font-medium text-violet-400">{j + 1}.</span>
                              <span>{t}</span>
                            </li>
                          ))}
                        </ul>
                      ) : ev.step === "compare" && compareData?.comparisons?.length ? (
                        <div className="mt-2 space-y-1">
                          {compareData.comparisons
                            .filter((c) => c.relevant)
                            .sort((a, b) => a.total - b.total)
                            .map((c) => (
                              <div
                                key={c.title}
                                className={`rounded-lg px-2 py-1 text-xs ${c.selected ? "bg-emerald-50 font-medium text-emerald-800 ring-1 ring-emerald-200" : "bg-slate-50 text-slate-600"}`}
                              >
                                {c.selected ? "★ Cheapest · " : ""}
                                {formatMoney(c.total)} — {c.title}
                              </div>
                            ))}
                          {!compareData.comparisons.some((c) => c.relevant) && (
                            <p className="text-xs text-slate-600">{ev.message}</p>
                          )}
                        </div>
                      ) : (
                        <p className="mt-1 whitespace-pre-line text-sm text-slate-800">{ev.message}</p>
                      )}

                      {scrapeData?.url && (
                        <a
                          href={scrapeData.url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 block break-all text-xs text-brand-600 hover:underline"
                        >
                          {scrapeData.url}
                        </a>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
        <div className="border-t border-slate-100 px-6 py-3 text-right">
          {isRunning && (
            <span className="mr-3 text-xs text-amber-600">Run in progress…</span>
          )}
          <button
            onClick={onClose}
            className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Agent["status"] }) {
  const styles = {
    ready: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
    running: "bg-amber-50 text-amber-700 ring-amber-600/20",
    completed: "bg-slate-100 text-slate-600 ring-slate-500/20",
  };
  const labels = { ready: "Ready", running: "Running", completed: "Done" };
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

const EXAMPLE_PROMPTS = [
  {
    label: "Bubble wrap",
    prompt:
      "Monitor wholesale prices for bubble wrap and automatically purchase 50 rolls when the price drops below $10.",
  },
  {
    label: "Carton boxes",
    prompt: "Monitor carton box prices on Shopee and buy 100 boxes when total price is under $15.",
  },
  {
    label: "Packing tape",
    prompt: "Buy 20 rolls of clear packing tape when price drops below $8.",
  },
  {
    label: "Custom cake",
    prompt: "Find a shin-chan customised birthday cake on Carousell under $50.",
  },
] as const;

function NewAgentModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (msg: string) => void;
}) {
  const [prompt, setPrompt] = useState(
    "Monitor wholesale prices for bubble wrap and automatically purchase 50 rolls when the price drops below $10."
  );
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await parseAgent(prompt);
      onCreated(result.message as string);
      onClose();
    } catch {
      onCreated("Failed to create agent");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">New Agent</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mb-3 text-sm text-slate-500">
          Describe what you want in plain English — no code needed.
        </p>
        <div className="mb-4 flex flex-wrap gap-2">
          <span className="w-full text-xs font-medium text-slate-400">Try an example:</span>
          {EXAMPLE_PROMPTS.map(({ label, prompt: examplePrompt }) => (
            <button
              key={label}
              type="button"
              onClick={() => setPrompt(examplePrompt)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                prompt === examplePrompt
                  ? "border-brand-300 bg-brand-50 text-brand-700 ring-1 ring-brand-200"
                  : "border-slate-200 bg-slate-50 text-slate-600 hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <form onSubmit={handleSubmit}>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={5}
            className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            placeholder="Monitor carton box prices on Shopee and buy 100 boxes when under $15..."
            required
          />
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Create Agent
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ApprovalCard({
  proposal,
  onProceedToPay,
  onReject,
  loading,
}: {
  proposal: PurchaseProposal;
  onProceedToPay: () => void;
  onReject: () => void;
  loading: boolean;
}) {
  return (
    <div className="mt-3 overflow-hidden rounded-2xl border border-amber-200 bg-amber-50/80">
      <div className="border-b border-amber-100 px-4 py-3">
        <p className="text-sm font-semibold text-amber-900">Can I buy this?</p>
        <p className="mt-1 text-xs text-amber-700">
          Agent Brain picked the cheapest relevant listing under your budget — confirm before PayNow.
        </p>
        {proposal.sellerName && (
          <p className="mt-2 inline-flex rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-medium text-emerald-800">
            via {proposal.sellerName}
          </p>
        )}
      </div>
      <div className="flex gap-4 p-4">
        <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white ring-1 ring-amber-100">
          {proposal.imageUrl ? (
            <img src={proposal.imageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <Package className="h-10 w-10 text-amber-300" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-slate-900">{proposal.title}</p>
          <p className="mt-1 text-lg font-semibold text-brand-700">{formatMoney(proposal.totalPrice)}</p>
          <p className="text-xs text-slate-500">{proposal.priceDetail}</p>
          <p className="mt-2 text-xs text-slate-600">
            For {proposal.quantity} {proposal.unit} of &ldquo;{proposal.product}&rdquo;
          </p>
          {proposal.verdictReason && (
            <p className="mt-1 text-xs text-violet-700">Why: {proposal.verdictReason}</p>
          )}
          <a
            href={proposal.url}
            target="_blank"
            rel="noreferrer"
            className="mt-2 block truncate text-xs text-brand-600 hover:underline"
          >
            View listing ↗
          </a>
        </div>
      </div>
      <div className="flex gap-2 border-t border-amber-100 bg-white/60 px-4 py-3">
        <button
          type="button"
          onClick={onReject}
          disabled={loading}
          className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          No, skip
        </button>
        <button
          type="button"
          onClick={onProceedToPay}
          disabled={loading}
          className="flex-1 rounded-xl bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Yes, buy it"}
        </button>
      </div>
    </div>
  );
}

export default function DashboardApp() {
  const [state, setState] = useState<DashboardState | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [agentRuns, setAgentRuns] = useState<Record<string, AgentRunRecord>>(() => loadAgentRuns());
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityAgentName, setActivityAgentName] = useState<string | null>(null);
  const [viewingAgentId, setViewingAgentId] = useState<string | null>(null);
  const [lastPayNow, setLastPayNow] = useState<PayNowPayload | null>(null);
  const [monitorStatus, setMonitorStatus] = useState<"Ready" | "Running">("Ready");
  const [runningId, setRunningId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>("dashboard");
  const [autoSearchEnabled, setAutoSearchEnabled] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<{
    runId: string;
    agent: Agent;
    proposal: PurchaseProposal;
  } | null>(null);
  const [approvalLoading, setApprovalLoading] = useState(false);
  const [bankModalOpen, setBankModalOpen] = useState(false);
  const [paynowPreview, setPaynowPreview] = useState<PayNowPreview | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const runEventsUnsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => runEventsUnsubRef.current?.();
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback(
    (message: string, kind: ToastKind = "info") => {
      const id = crypto.randomUUID();
      setToasts((prev) => [...prev.slice(-4), { id, message, kind }]);
      window.setTimeout(() => dismissToast(id), 6000);
    },
    [dismissToast]
  );

  const refresh = useCallback(async () => {
    const data = await fetchState();
    setState(data);
    setAutoSearchEnabled(data.inventorySettings.autoSearchEnabled);
  }, []);

  useEffect(() => {
    refresh().catch(console.error);
  }, [refresh]);

  useEffect(() => {
    saveAgentRuns(agentRuns);
  }, [agentRuns]);

  const addLog = (message: string, status: ActivityEvent["status"] = "done") => {
    setActivity((prev) =>
      mergeActivityEvents(prev, {
        runId: "local",
        step: "log",
        message,
        status,
        timestamp: new Date().toISOString(),
      })
    );
  };

  const subscribeToAgentRun = useCallback(
    (agent: Agent, runId: string, initialEvents: ActivityEvent[] = []) => {
      runEventsUnsubRef.current?.();
      runEventsUnsubRef.current = null;

      setRunningId(agent.agentId);
      setActiveRunId(runId);
      setMonitorStatus("Running");
      setPendingApproval(null);
      setActivity(initialEvents);
      setActivityAgentName(agent.name);
      setViewingAgentId(agent.agentId);
      setAgentRuns((prev) => ({
        ...prev,
        [agent.agentId]: {
          activity: initialEvents,
          summary: deriveRunSummary(initialEvents),
          finishedAt: null,
        },
      }));

      runEventsUnsubRef.current = subscribeRunEvents(agent.agentId, runId, (ev) => {
        if (ev.runId !== "local" && ev.runId !== runId) return;

        setActivity((prev) => {
          const next = mergeActivityEvents(prev, ev);
          const finished = ["complete", "no_match", "rejected", "error"].includes(ev.step);
          setAgentRuns((r) => ({
            ...r,
            [agent.agentId]: {
              activity: next,
              summary: deriveRunSummary(next),
              finishedAt: finished ? new Date().toISOString() : r[agent.agentId]?.finishedAt ?? null,
            },
          }));
          return next;
        });
        if (ev.step === "approval" && ev.status === "running" && ev.data && typeof ev.data === "object") {
          const data = ev.data as { proposal?: PurchaseProposal };
          if (data.proposal) {
            setPendingApproval({ runId, agent, proposal: data.proposal });
          }
        }
        if (ev.step === "complete" && ev.data && typeof ev.data === "object") {
          const data = ev.data as { paynow?: PayNowPayload };
          if (data.paynow) setLastPayNow(data.paynow);
        }
        if (ev.step === "settle" && ev.data && typeof ev.data === "object") {
          const data = ev.data as { paynow?: PayNowPayload };
          if (data.paynow?.status === "COMPLETED") setLastPayNow(data.paynow);
        }
        if (ev.step === "complete") {
          pushToast(ev.message || `${agent.name} finished — inventory updated`, "success");
        } else if (ev.step === "no_match") {
          pushToast(ev.message || `${agent.name} found no suitable listing`, "warning");
        } else if (ev.step === "rejected") {
          pushToast("Purchase declined — no payment sent", "info");
        } else if (ev.step === "error") {
          pushToast(ev.message || `${agent.name} run failed`, "error");
        }
        if (ev.step === "complete" || ev.step === "no_match" || ev.step === "rejected" || ev.step === "error") {
          runEventsUnsubRef.current?.();
          runEventsUnsubRef.current = null;
          setMonitorStatus("Ready");
          setRunningId(null);
          setActiveRunId(null);
          setPendingApproval(null);
          refresh();
        }
      });
    },
    [pushToast, refresh]
  );

  const handleRun = async (agent: Agent) => {
    if (agent.status === "running" || runningId) return;

    const starting = mergeActivityEvents([], {
      runId: "local",
      step: "log",
      message: `Starting ${agent.name}...`,
      status: "running",
      timestamp: new Date().toISOString(),
    });

    try {
      const { runId } = await runAgentApi(agent.agentId);
      subscribeToAgentRun(agent, runId, starting);
    } catch {
      const errEvents = mergeActivityEvents(starting, {
        runId: "local",
        step: "error",
        message: "Failed to start agent run",
        status: "error",
        timestamp: new Date().toISOString(),
      });
      setActivity(errEvents);
      setAgentRuns((r) => ({
        ...r,
        [agent.agentId]: {
          activity: errEvents,
          summary: "Failed to start",
          finishedAt: new Date().toISOString(),
        },
      }));
      setMonitorStatus("Ready");
      setRunningId(null);
    }
  };

  const handleInventoryTriggeredRun = (agent: Agent, runId: string) => {
    if (runningId) return;
    const starting = mergeActivityEvents([], {
      runId,
      step: "log",
      message: `Auto-restock triggered for ${agent.name} — inventory below reorder level.`,
      status: "running",
      timestamp: new Date().toISOString(),
    });
    subscribeToAgentRun(agent, runId, starting);
    setActivityOpen(true);
    pushToast(`Auto-restock started — ${agent.name} is searching now`, "info");
  };

  const handleDelete = async (agent: Agent) => {
    if (runningId || deletingId) return;
    if (agent.status === "running") {
      pushToast("Wait for the agent to finish before deleting", "warning");
      return;
    }

    const ok = window.confirm(`Delete "${agent.name}"? This cannot be undone.`);
    if (!ok) return;

    setDeletingId(agent.agentId);
    try {
      await deleteAgentApi(agent.agentId);
      setAgentRuns((prev) => {
        const next = { ...prev };
        delete next[agent.agentId];
        return next;
      });
      if (viewingAgentId === agent.agentId) {
        setActivityOpen(false);
        setViewingAgentId(null);
        setActivityAgentName(null);
      }
      await refresh();
      pushToast(`Deleted ${agent.name}`, "success");
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "Failed to delete agent", "error");
    } finally {
      setDeletingId(null);
    }
  };

  const openAgentActivity = (agent: Agent) => {
    const isLive = runningId === agent.agentId;
    const stored = agentRuns[agent.agentId];
    setViewingAgentId(agent.agentId);
    setActivityAgentName(agent.name);
    setActivity(isLive ? activity : stored?.activity ?? []);
    setActivityOpen(true);
  };

  const handleProceedToPay = async () => {
    if (!activeRunId || approvalLoading) return;
    setApprovalLoading(true);
    try {
      const preview = await fetchPayNowPreview(activeRunId);
      setPaynowPreview(preview);
      setBankModalOpen(true);
    } catch {
      addLog("Failed to load PayNow preview", "error");
    } finally {
      setApprovalLoading(false);
    }
  };

  const handleBankConfirm = async () => {
    if (!activeRunId || approvalLoading) return;
    setApprovalLoading(true);
    try {
      await approveRun(activeRunId);
      setBankModalOpen(false);
      setPaynowPreview(null);
    } catch {
      addLog("Failed to confirm payment", "error");
    } finally {
      setApprovalLoading(false);
    }
  };

  const handleReject = async () => {
    if (!activeRunId || approvalLoading) return;
    setApprovalLoading(true);
    try {
      await rejectRun(activeRunId);
    } catch {
      addLog("Failed to reject purchase", "error");
    } finally {
      setApprovalLoading(false);
    }
  };

  const openApprovalFromToast = () => {
    if (!pendingApproval) return;
    setViewingAgentId(pendingApproval.agent.agentId);
    setActivityAgentName(pendingApproval.agent.name);
    setActivity(pendingApproval.agent.agentId === runningId ? activity : agentRuns[pendingApproval.agent.agentId]?.activity ?? activity);
    setActivityOpen(true);
  };

  const activeAgents = state?.agents.filter((a) => a.status === "ready" || a.status === "running").length ?? 0;
  const latestPayNow =
    lastPayNow ?? state?.transactions.find((tx) => tx.paynowPayload)?.paynowPayload ?? null;

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="hidden w-64 flex-col border-r border-slate-200 bg-white p-5 lg:flex">
        <div className="mb-8">
          <BrandLogo className="h-14 w-auto" />
          <div className="mt-2 text-xs text-slate-500">BUILD2026 MVP</div>
        </div>
        <nav className="space-y-1">
          <button
            type="button"
            onClick={() => setActiveTab("dashboard")}
            className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium ${
              activeTab === "dashboard"
                ? "bg-brand-50 text-brand-700"
                : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            <Bot className="h-4 w-4" /> Dashboard
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("inventory")}
            className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium ${
              activeTab === "inventory"
                ? "bg-brand-50 text-brand-700"
                : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            <Package className="h-4 w-4" /> Inventory
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("payments")}
            className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium ${
              activeTab === "payments"
                ? "bg-brand-50 text-brand-700"
                : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            <Receipt className="h-4 w-4" /> Payments
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("integrations")}
            className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium ${
              activeTab === "integrations"
                ? "bg-brand-50 text-brand-700"
                : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            <Plug className="h-4 w-4" /> Integrations
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("settings")}
            className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium ${
              activeTab === "settings"
                ? "bg-brand-50 text-brand-700"
                : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            <Settings className="h-4 w-4" /> Settings
          </button>
        </nav>
        <div className="mt-auto space-y-3 rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs text-slate-600">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Network: Singapore
          </div>
          <div>Active agents: {activeAgents}</div>
          <div className="space-y-1 border-t border-slate-200 pt-2">
            <div className="font-medium text-slate-500">Stack</div>
            <div>Exa → Seller Agent → PayNow</div>
          </div>
          <Link to="/" className="block pt-2 text-brand-600 hover:underline">
            ← Back to landing
          </Link>
        </div>
      </aside>

      {/* Main */}
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
          <div>
            <h1 className="text-xl font-semibold">{TAB_META[activeTab].title}</h1>
            <p className="text-sm text-slate-500">{TAB_META[activeTab].subtitle}</p>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                monitorStatus === "Running"
                  ? "bg-amber-50 text-amber-700"
                  : "bg-emerald-50 text-emerald-700"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  monitorStatus === "Running" ? "bg-amber-500 animate-pulse" : "bg-emerald-500"
                }`}
              />
              Agent Monitor: {monitorStatus}
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-sm font-medium text-brand-700">
              A
            </div>
          </div>
        </header>

        {activeTab === "dashboard" ? (
        <main className="flex-1 space-y-6 p-6">
          {/* KPIs */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:col-span-2 lg:col-span-1">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500">Total Balance</p>
                  <p className="mt-1 text-2xl font-semibold">
                    {state ? formatMoney(state.balance) : "—"}
                  </p>
                </div>
                <Wallet className="h-8 w-8 text-brand-500 opacity-80" />
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500">Active Agents</p>
                  <p className="mt-1 text-2xl font-semibold">
                    {activeAgents} <span className="text-base font-normal text-slate-400">of {state?.agents.length ?? 0}</span>
                  </p>
                </div>
                <Bot className="h-8 w-8 text-brand-500 opacity-80" />
              </div>
            </div>
            <CommercePipeline
              activeStep={
                runningId
                  ? activityForDisplay(activity, activeRunId).some(
                      (e) => e.step === "settle" || e.step === "complete"
                    )
                    ? "pay"
                    : activityForDisplay(activity, activeRunId).some(
                          (e) => e.step === "reasoning" || e.step === "compare"
                        )
                      ? "brain"
                      : activityForDisplay(activity, activeRunId).some(
                            (e) =>
                              e.step === "scrape" &&
                              (e.data as { progress?: string[] })?.progress?.some(isSellerAgentProgressLine)
                          )
                        ? "seller"
                        : "search"
                  : undefined
              }
            />
          </div>

          {/* Agents table — full width */}
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="font-semibold">My Agents</h2>
              <button
                onClick={() => setModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
              >
                <Plus className="h-4 w-4" /> New Agent
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-slate-500">
                    <th className="px-5 py-3 font-medium">Agent</th>
                    <th className="px-5 py-3 font-medium">Rule</th>
                    <th className="px-5 py-3 font-medium">Latest run</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {state?.agents.map((agent) => {
                    const run = agentRuns[agent.agentId];
                    const isRunning = runningId === agent.agentId;
                    const lastRunAt = formatRunTimestamp(run?.finishedAt);
                    return (
                    <tr key={agent.agentId} className="border-b border-slate-50">
                      <td className="px-5 py-4">
                        <div className="font-medium">{agent.name}</div>
                        <div className="text-xs text-slate-400">{agent.product}</div>
                      </td>
                      <td className="px-5 py-4 text-slate-600">
                        Buy {agent.quantity} {agent.unit} if &lt; {formatMoney(agent.trigger.threshold)}
                      </td>
                      <td className="max-w-xs px-5 py-4 text-xs text-slate-500">
                        {isRunning ? (
                          <span className="inline-flex items-center gap-1 text-amber-600">
                            <Loader2 className="h-3 w-3 animate-spin" /> Running…
                          </span>
                        ) : run ? (
                          <div className="space-y-0.5">
                            <span className="line-clamp-2">{run.summary}</span>
                            {lastRunAt && (
                              <span className="block text-[10px] text-slate-400">Last run: {lastRunAt}</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400">No runs yet</span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <StatusBadge status={isRunning ? "running" : agent.status} />
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            onClick={() => handleRun(agent)}
                            disabled={!!runningId}
                            className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-100 disabled:opacity-50"
                          >
                            Run Agent
                          </button>
                          <button
                            onClick={() => openAgentActivity(agent)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                          >
                            <ListTree className="h-3.5 w-3.5" />
                            View Activity
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(agent)}
                            disabled={!!runningId || !!deletingId || isRunning}
                            className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-40"
                          >
                            {deletingId === agent.agentId ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="max-w-xl">
            <PayNowReceipt payload={latestPayNow} />
            {(state?.transactions.length ?? 0) > 0 && (
              <button
                type="button"
                onClick={() => setActiveTab("payments")}
                className="mt-3 text-sm font-medium text-brand-600 hover:text-brand-700 hover:underline"
              >
                View all payments ({state?.transactions.length}) →
              </button>
            )}
          </div>
        </main>
        ) : activeTab === "inventory" ? (
          state && (
            <InventoryView
              state={state}
              agents={state.agents}
              agentRuns={agentRuns}
              autoSearchEnabled={autoSearchEnabled}
              onAutoSearchChange={setAutoSearchEnabled}
              onRefresh={refresh}
              onAgentTriggered={handleInventoryTriggeredRun}
              onViewActivity={openAgentActivity}
              onToast={pushToast}
              runningId={runningId}
            />
          )
        ) : activeTab === "payments" ? (
          state && <PaymentsView state={state} />
        ) : activeTab === "settings" ? (
          state && (
            <SettingsView profile={state.businessProfile} onRefresh={refresh} onToast={pushToast} />
          )
        ) : (
          <IntegrationsView
            onAgentCreated={() => {
              void refresh();
            }}
            onAgentRun={handleInventoryTriggeredRun}
            onGoToDashboard={() => setActiveTab("dashboard")}
            onToast={pushToast}
          />
        )}

        <footer className="border-t border-slate-200 px-6 py-3 text-center text-xs text-slate-400">
          MajuBiz MVP Demo v0.1.0 — Built for Singapore SMEs at BUILD2026 · State resets on server restart
        </footer>
      </div>

      <NewAgentModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(msg) => {
          addLog(msg);
          refresh();
        }}
      />

      <ActivityModal
        open={activityOpen}
        onClose={() => setActivityOpen(false)}
        activeRunId={activeRunId}
        activity={
          viewingAgentId && runningId === viewingAgentId ? activity : agentRuns[viewingAgentId ?? ""]?.activity ?? activity
        }
        agentName={activityAgentName}
        isRunning={!!runningId && viewingAgentId === runningId}
        pendingApproval={
          pendingApproval && viewingAgentId === pendingApproval.agent.agentId ? pendingApproval.proposal : null
        }
        onProceedToPay={handleProceedToPay}
        onReject={handleReject}
        approvalLoading={approvalLoading}
      />

      <PayNowBankModal
        open={bankModalOpen}
        preview={paynowPreview}
        loading={approvalLoading}
        onClose={() => {
          if (!approvalLoading) {
            setBankModalOpen(false);
            setPaynowPreview(null);
          }
        }}
        onConfirm={handleBankConfirm}
      />

      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      {pendingApproval && (
        <button
          type="button"
          onClick={openApprovalFromToast}
          className="fixed bottom-6 right-6 z-40 max-w-sm rounded-2xl border border-amber-200 bg-white p-4 text-left shadow-xl ring-1 ring-amber-100 hover:ring-amber-300"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-amber-600">Approval needed</p>
          <p className="mt-1 font-semibold text-slate-900">Can I buy this for {formatMoney(pendingApproval.proposal.totalPrice)}?</p>
          {pendingApproval.proposal.sellerName && (
            <p className="mt-1 text-xs text-emerald-700">from {pendingApproval.proposal.sellerName}</p>
          )}
          <p className="mt-1 line-clamp-2 text-sm text-slate-600">{pendingApproval.proposal.title}</p>
          <p className="mt-2 text-xs font-medium text-brand-600">Tap to review →</p>
        </button>
      )}
    </div>
  );
}
