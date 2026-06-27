import {
  Bot,
  CheckCircle2,
  Circle,
  ListTree,
  Loader2,
  Plus,
  Shield,
  Wallet,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ActivityEvent, Agent, DashboardState, PayNowPayload } from "./lib/api";
import {
  fetchState,
  parseAgent,
  runAgent as runAgentApi,
  subscribeRunEvents,
} from "./lib/api";

function formatMoney(amount: number) {
  return `S$${amount.toFixed(2)}`;
}

function sourceLabel(source: string) {
  if (source === "exa") return { text: "Live via Exa", className: "bg-violet-50 text-violet-700" };
  return { text: "Demo fallback", className: "bg-amber-50 text-amber-700" };
}

const STEP_ORDER = [
  "log",
  "start",
  "scrape",
  "scrape_done",
  "source_url",
  "settle",
  "no_match",
  "complete",
  "error",
] as const;

function mergeActivityEvents(prev: ActivityEvent[], incoming: ActivityEvent): ActivityEvent[] {
  const map = new Map(prev.map((e) => [e.step, e]));
  map.set(incoming.step, incoming);

  const incomingIdx = STEP_ORDER.indexOf(incoming.step as (typeof STEP_ORDER)[number]);

  for (const [step, event] of map) {
    const idx = STEP_ORDER.indexOf(step as (typeof STEP_ORDER)[number]);
    if (idx >= 0 && idx < incomingIdx && event.status === "running") {
      map.set(step, { ...event, status: "done" });
    }
  }

  if (["complete", "no_match", "error"].includes(incoming.step)) {
    for (const [step, event] of map) {
      if (event.status === "running") {
        map.set(step, { ...event, status: "done" });
      }
    }
  }

  return STEP_ORDER.filter((s) => map.has(s)).map((s) => map.get(s)!);
}

function stepLabel(step: string): string {
  const labels: Record<string, string> = {
    log: "Initiate",
    start: "Agent run",
    scrape: "Web search",
    scrape_done: "Price found",
    source_url: "Listing",
    settle: "PayNow settlement",
    no_match: "No purchase",
    complete: "Complete",
    error: "Error",
  };
  return labels[step] ?? step;
}

function ActivityModal({
  open,
  onClose,
  activity,
  agentName,
  isRunning,
}: {
  open: boolean;
  onClose: () => void;
  activity: ActivityEvent[];
  agentName: string | null;
  isRunning: boolean;
}) {
  if (!open) return null;

  const steps = [...activity].sort(
    (a, b) => STEP_ORDER.indexOf(a.step as (typeof STEP_ORDER)[number]) - STEP_ORDER.indexOf(b.step as (typeof STEP_ORDER)[number])
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
                const isUrlStep = ev.step === "source_url";

                return (
                  <li key={ev.step} className="flex gap-3">
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
                      {!isUrlStep && (
                        <p className="mt-1 text-sm text-slate-800">{ev.message}</p>
                      )}
                      {isUrlStep && (
                        <a
                          href={ev.message}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 block break-all text-sm text-brand-600 hover:underline"
                        >
                          {ev.message}
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
        <p className="mb-4 text-sm text-slate-500">
          Describe what you want in plain English — no code needed.
        </p>
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

function PayNowPanel({ payload }: { payload: PayNowPayload | null }) {
  if (!payload) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-2 font-semibold">PayNow Gen 2 Payload</h3>
        <p className="text-sm text-slate-500">Run an agent to see structured settlement JSON.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold">PayNow Gen 2 Payload</h3>
        <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
          REQUEST_TO_PAY
        </span>
      </div>
      <pre className="max-h-64 overflow-auto rounded-xl bg-slate-900 p-4 text-xs text-emerald-300">
        {JSON.stringify(payload, null, 2)}
      </pre>
    </div>
  );
}

export default function App() {
  const [state, setState] = useState<DashboardState | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityAgentName, setActivityAgentName] = useState<string | null>(null);
  const [lastPayNow, setLastPayNow] = useState<PayNowPayload | null>(null);
  const [monitorStatus, setMonitorStatus] = useState<"Ready" | "Running">("Ready");
  const [runningId, setRunningId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const data = await fetchState();
    setState(data);
  }, []);

  useEffect(() => {
    refresh().catch(console.error);
  }, [refresh]);

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

  const handleRun = async (agent: Agent) => {
    if (agent.status === "running" || runningId) return;
    setRunningId(agent.agentId);
    setMonitorStatus("Running");
    setActivity([]);
    setActivityAgentName(agent.name);
    setActivityOpen(true);
    addLog(`Starting ${agent.name}...`, "running");

    try {
      const { runId } = await runAgentApi(agent.agentId);
      subscribeRunEvents(agent.agentId, runId, (ev) => {
        setActivity((prev) => mergeActivityEvents(prev, ev));
        if (ev.step === "complete" && ev.data && typeof ev.data === "object") {
          const data = ev.data as { paynow?: PayNowPayload };
          if (data.paynow) setLastPayNow(data.paynow);
        }
        if (ev.step === "complete" || ev.step === "no_match" || ev.step === "error") {
          setMonitorStatus("Ready");
          setRunningId(null);
          refresh();
        }
      });
    } catch {
      setActivity((prev) =>
        mergeActivityEvents(prev, {
          runId: "local",
          step: "error",
          message: "Failed to start agent run",
          status: "error",
          timestamp: new Date().toISOString(),
        })
      );
      setMonitorStatus("Ready");
      setRunningId(null);
    }
  };

  const activeAgents = state?.agents.filter((a) => a.status === "ready" || a.status === "running").length ?? 0;

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="hidden w-64 flex-col border-r border-slate-200 bg-white p-5 lg:flex">
        <div className="mb-8 flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <div className="font-semibold">MajuBiz</div>
            <div className="text-xs text-slate-500">BUILD2026 MVP</div>
          </div>
        </div>
        <nav className="space-y-1">
          <a className="flex items-center gap-2 rounded-xl bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700">
            <Bot className="h-4 w-4" /> Dashboard
          </a>
        </nav>
        <div className="mt-auto space-y-3 rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs text-slate-600">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Network: Singapore
          </div>
          <div>Active agents: {activeAgents}</div>
          <div className="text-slate-400">Powered by Exa + OpenAI</div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
          <div>
            <h1 className="text-xl font-semibold">Dashboard</h1>
            <p className="text-sm text-slate-500">Zero-code agentic commerce for Singapore SMEs</p>
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

        <main className="flex-1 space-y-6 p-6">
          {/* KPIs */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
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
          </div>

          {/* Agents table — full width */}
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="font-semibold">My Agents</h2>
              <div className="flex items-center gap-2">
                {activity.length > 0 && (
                  <button
                    onClick={() => setActivityOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <ListTree className="h-4 w-4" />
                    View Activity
                    {runningId && <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-500" />}
                  </button>
                )}
                <button
                  onClick={() => setModalOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
                >
                  <Plus className="h-4 w-4" /> New Agent
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-slate-500">
                    <th className="px-5 py-3 font-medium">Agent</th>
                    <th className="px-5 py-3 font-medium">Rule</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {state?.agents.map((agent) => (
                    <tr key={agent.agentId} className="border-b border-slate-50">
                      <td className="px-5 py-4">
                        <div className="font-medium">{agent.name}</div>
                        <div className="text-xs text-slate-400">{agent.product}</div>
                      </td>
                      <td className="px-5 py-4 text-slate-600">
                        Buy {agent.quantity} {agent.unit} if &lt; {formatMoney(agent.trigger.threshold)}
                      </td>
                      <td className="px-5 py-4">
                        <StatusBadge status={runningId === agent.agentId ? "running" : agent.status} />
                      </td>
                      <td className="px-5 py-4">
                        <button
                          onClick={() => handleRun(agent)}
                          disabled={!!runningId}
                          className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-100 disabled:opacity-50"
                        >
                          Run Agent
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Transactions */}
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-5 py-4">
                <h2 className="font-semibold">Recent Transactions</h2>
              </div>
              <div className="divide-y divide-slate-50">
                {state?.transactions.length === 0 ? (
                  <p className="p-5 text-sm text-slate-400">No transactions yet.</p>
                ) : (
                  state?.transactions.map((tx) => {
                    const badge = sourceLabel(tx.source);
                    const supplier = tx.paynowPayload?.creditor?.name;
                    return (
                    <div key={tx.id} className="flex items-start justify-between gap-4 px-5 py-4">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium capitalize">{tx.description}</div>
                        <div className="text-xs text-slate-400">{tx.agentName}</div>
                        {supplier && (
                          <div className="mt-1 text-xs text-slate-600">Seller: {supplier}</div>
                        )}
                        <span className={`mt-2 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}>
                          {badge.text}
                        </span>
                        {tx.url ? (
                          <a
                            href={tx.url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 block break-all text-xs text-brand-600 hover:underline"
                          >
                            {tx.url}
                          </a>
                        ) : (
                          <p className="mt-1 text-xs text-slate-400">No listing URL — add EXA_API_KEY for live Shopee links</p>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-medium text-red-600">− {formatMoney(tx.amount)}</div>
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                          {tx.status}
                        </span>
                      </div>
                    </div>
                    );
                  })
                )}
              </div>
            </div>

            <PayNowPanel payload={lastPayNow} />
          </div>
        </main>

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
        activity={activity}
        agentName={activityAgentName}
        isRunning={!!runningId}
      />
    </div>
  );
}
