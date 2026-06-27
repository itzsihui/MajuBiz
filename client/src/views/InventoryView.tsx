import { AlertTriangle, CheckCircle2, ListTree, Loader2, Package, Save } from "lucide-react";
import { useEffect, useState } from "react";
import type { Agent, DashboardState, InventoryItem } from "../lib/api";
import { saveInventoryItem, updateInventorySettings } from "../lib/api";

interface DraftValues {
  currentStock: number;
  reorderThreshold: number;
}

export interface InventoryAgentRun {
  summary: string;
  finishedAt: string | null;
}

type ToastKind = "success" | "error" | "info" | "warning";

interface InventoryViewProps {
  state: DashboardState;
  agents: Agent[];
  agentRuns: Record<string, InventoryAgentRun>;
  autoSearchEnabled: boolean;
  onAutoSearchChange: (enabled: boolean) => void;
  onRefresh: () => Promise<void>;
  onAgentTriggered: (agent: Agent, runId: string) => void;
  onViewActivity: (agent: Agent) => void;
  onToast: (message: string, kind?: ToastKind) => void;
  runningId: string | null;
}

function stockStatus(item: InventoryItem) {
  if (item.currentStock <= item.reorderThreshold) {
    return {
      label: "Low stock",
      className: "bg-amber-50 text-amber-700 ring-amber-600/20",
      icon: AlertTriangle,
    };
  }
  return {
    label: "OK",
    className: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
    icon: CheckCircle2,
  };
}

export function InventoryView({
  state,
  agents,
  agentRuns,
  autoSearchEnabled,
  onAutoSearchChange,
  onRefresh,
  onAgentTriggered,
  onViewActivity,
  onToast,
  runningId,
}: InventoryViewProps) {
  const [drafts, setDrafts] = useState<Record<string, DraftValues>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [toggleLoading, setToggleLoading] = useState(false);

  useEffect(() => {
    const next: Record<string, DraftValues> = {};
    for (const item of state.inventory) {
      next[item.id] = {
        currentStock: item.currentStock,
        reorderThreshold: item.reorderThreshold,
      };
    }
    setDrafts(next);
  }, [state.inventory]);

  const handleToggle = async () => {
    setToggleLoading(true);
    try {
      const next = !autoSearchEnabled;
      await updateInventorySettings(next);
      onAutoSearchChange(next);
      onToast(
        next ? "Auto-search enabled — low stock will trigger linked agents." : "Auto-search disabled.",
        next ? "success" : "info"
      );
    } catch {
      onToast("Failed to update auto-search setting.", "error");
    } finally {
      setToggleLoading(false);
    }
  };

  const handleSave = async (item: InventoryItem) => {
    const draft = drafts[item.id];
    if (!draft) return;

    setSavingId(item.id);
    try {
      const result = await saveInventoryItem(item.id, {
        currentStock: draft.currentStock,
        reorderThreshold: draft.reorderThreshold,
      });
      await onRefresh();

      if (result.triggered && result.runId && result.agent) {
        onToast(result.message ?? `Auto-restock started for ${result.agent.name}`, "success");
        onAgentTriggered(result.agent, result.runId);
      } else if (result.lowStock && !autoSearchEnabled) {
        onToast(
          `${item.product} is below reorder level — turn on auto-search to restock automatically.`,
          "warning"
        );
      } else if (result.message) {
        onToast(result.message, result.lowStock ? "warning" : "info");
      } else {
        onToast(`Saved ${item.product} — ${draft.currentStock} ${item.unit} in stock`, "success");
      }
    } catch {
      onToast(`Failed to save ${item.product}.`, "error");
    } finally {
      setSavingId(null);
    }
  };

  const updateDraft = (itemId: string, field: keyof DraftValues, value: number) => {
    setDrafts((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], [field]: value },
    }));
  };

  const restockAgentForItem = (item: InventoryItem) => {
    if (item.linkedAgentId) {
      return agents.find((a) => a.agentId === item.linkedAgentId) ?? null;
    }
    const norm = item.product.toLowerCase().replace(/[^a-z0-9]/g, "");
    return (
      agents.find((a) => {
        const pn = a.product.toLowerCase().replace(/[^a-z0-9]/g, "");
        return pn === norm || pn.includes(norm) || norm.includes(pn);
      }) ?? null
    );
  };

  return (
    <main className="flex-1 space-y-6 p-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-semibold">Auto-restock</h2>
            <p className="mt-1 text-sm text-slate-500">
              When stock is at or below reorder level and auto-search is on, Save instantly starts a buyer agent — no
              Dashboard setup needed.
            </p>
          </div>
          <button
            type="button"
            onClick={handleToggle}
            disabled={toggleLoading}
            className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${
              autoSearchEnabled ? "bg-brand-600" : "bg-slate-300"
            } disabled:opacity-60`}
            role="switch"
            aria-checked={autoSearchEnabled}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                autoSearchEnabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span
            className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
              autoSearchEnabled
                ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
                : "bg-slate-100 text-slate-600 ring-slate-500/20"
            }`}
          >
            {autoSearchEnabled ? "Auto-search ON" : "Auto-search OFF"}
          </span>
          {runningId && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
              <Loader2 className="h-3 w-3 animate-spin" />
              Agent running — stock will refresh when complete
            </span>
          )}
          {toggleLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
        </div>
        {autoSearchEnabled && (
          <p className="mt-3 rounded-xl bg-brand-50 px-3 py-2 text-xs text-brand-800">
            Demo: turn auto-search on, set any product at or below its reorder level, click Save — a restock agent
            spawns and searches immediately. Watch via <strong>View Activity</strong>.
          </p>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
          <Package className="h-4 w-4 text-slate-500" />
          <h2 className="font-semibold">Inventory</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-slate-500">
                <th className="px-5 py-3 font-medium">Product</th>
                <th className="px-5 py-3 font-medium">In stock</th>
                <th className="px-5 py-3 font-medium">Reorder at</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Restock agent</th>
                <th className="px-5 py-3 font-medium">Latest run</th>
                <th className="px-5 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {state.inventory.map((item) => {
                const draft = drafts[item.id] ?? {
                  currentStock: item.currentStock,
                  reorderThreshold: item.reorderThreshold,
                };
                const preview = { ...item, ...draft };
                const status = stockStatus(preview);
                const StatusIcon = status.icon;
                const agent = restockAgentForItem(item);
                const isDirty =
                  draft.currentStock !== item.currentStock ||
                  draft.reorderThreshold !== item.reorderThreshold;
                const isSaving = savingId === item.id;
                const agentRunning = !!agent && runningId === agent.agentId;
                const run = agent ? agentRuns[agent.agentId] : undefined;
                const hasActivity = agentRunning || !!run;

                return (
                  <tr key={item.id} className="border-b border-slate-50">
                    <td className="px-5 py-4">
                      <div className="font-medium capitalize">{item.product}</div>
                      <div className="text-xs text-slate-400">{item.unit}</div>
                    </td>
                    <td className="px-5 py-4">
                      <input
                        type="number"
                        min={0}
                        value={draft.currentStock}
                        onChange={(e) =>
                          updateDraft(item.id, "currentStock", Math.max(0, Number(e.target.value) || 0))
                        }
                        className="w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                      />
                    </td>
                    <td className="px-5 py-4">
                      <input
                        type="number"
                        min={0}
                        value={draft.reorderThreshold}
                        onChange={(e) =>
                          updateDraft(
                            item.id,
                            "reorderThreshold",
                            Math.max(0, Number(e.target.value) || 0)
                          )
                        }
                        className="w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                      />
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${status.className}`}
                      >
                        <StatusIcon className="h-3 w-3" />
                        {status.label}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-slate-600">
                      {agent ? (
                        <span className="font-medium text-slate-700">{agent.name}</span>
                      ) : autoSearchEnabled ? (
                        <span className="text-slate-400">Spawns on Save</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="max-w-xs px-5 py-4 text-xs text-slate-500">
                      {!agent ? (
                        "—"
                      ) : agentRunning ? (
                        <span className="inline-flex items-center gap-1 text-amber-600">
                          <Loader2 className="h-3 w-3 animate-spin" /> Running…
                        </span>
                      ) : run ? (
                        <span className="line-clamp-2">{run.summary}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleSave(item)}
                          disabled={!isDirty || isSaving || agentRunning}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-100 disabled:opacity-40"
                        >
                          {isSaving ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Save className="h-3.5 w-3.5" />
                          )}
                          Save
                        </button>
                        {agent && (
                          <button
                            type="button"
                            onClick={() => onViewActivity(agent)}
                            disabled={!hasActivity}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                          >
                            <ListTree className="h-3.5 w-3.5" />
                            View Activity
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
