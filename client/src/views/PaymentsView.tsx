import { Download, Receipt } from "lucide-react";
import { useState } from "react";
import { PayNowReceipt } from "../components/PayNowReceipt";
import type { DashboardState, Transaction } from "../lib/api";
import { exportPaymentsToCsv } from "../lib/exportPayments";

function formatMoney(amount: number) {
  return `S$${amount.toFixed(2)}`;
}

function sourceLabel(source: string, sellerName?: string) {
  if (source === "exa") return { text: "Live via Exa", className: "bg-violet-50 text-violet-700" };
  if (source === "seller-agent") {
    return {
      text: sellerName ? sellerName : "Seller Agent API",
      className: "bg-emerald-50 text-emerald-700",
    };
  }
  if (source === "shopee-open") return { text: "Shopee Open Platform", className: "bg-orange-50 text-orange-700" };
  return { text: "Demo fallback", className: "bg-amber-50 text-amber-700" };
}

interface PaymentsViewProps {
  state: DashboardState;
}

function PaymentRow({ tx, selected, onSelect }: { tx: Transaction; selected: boolean; onSelect: () => void }) {
  const badge = sourceLabel(tx.source, tx.paynowPayload?.creditor?.name);
  const supplier = tx.paynowPayload?.creditor?.name;
  const ref = tx.paynowPayload?.transactionRef;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-start justify-between gap-4 px-5 py-4 text-left transition hover:bg-slate-50 ${
        selected ? "bg-brand-50/60 ring-1 ring-inset ring-brand-100" : ""
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium capitalize">{tx.description}</span>
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">{tx.status}</span>
        </div>
        <div className="mt-1 text-xs text-slate-500">
          {new Date(tx.createdAt).toLocaleString("en-SG")} · {tx.agentName}
        </div>
        {supplier && <div className="mt-1 text-xs text-slate-600">Paid to {supplier}</div>}
        {ref && <div className="mt-1 text-[11px] text-slate-400">Ref {ref}</div>}
        <span className={`mt-2 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}>
          {badge.text}
        </span>
      </div>
      <div className="shrink-0 text-right">
        <div className="font-semibold text-red-600">− {formatMoney(tx.amount)}</div>
      </div>
    </button>
  );
}

export function PaymentsView({ state }: PaymentsViewProps) {
  const transactions = state.transactions;
  const [selectedId, setSelectedId] = useState<string | null>(transactions[0]?.id ?? null);

  const totalSpent = transactions.reduce((sum, tx) => sum + tx.amount, 0);
  const selectedTx = transactions.find((tx) => tx.id === selectedId) ?? transactions[0] ?? null;

  const handleExport = () => {
    if (transactions.length === 0) return;
    exportPaymentsToCsv(transactions);
  };

  return (
    <main className="flex-1 space-y-6 p-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Wallet balance</p>
          <p className="mt-1 text-2xl font-semibold">{formatMoney(state.balance)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Total payments</p>
          <p className="mt-1 text-2xl font-semibold">{transactions.length}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Total spent</p>
          <p className="mt-1 text-2xl font-semibold text-red-600">{formatMoney(totalSpent)}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm lg:col-span-3">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div className="flex items-center gap-2">
              <Receipt className="h-4 w-4 text-slate-500" />
              <h2 className="font-semibold">All PayNow settlements</h2>
            </div>
            <button
              type="button"
              onClick={handleExport}
              disabled={transactions.length === 0}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" />
              Export to Excel
            </button>
          </div>
          <div className="divide-y divide-slate-50">
            {transactions.length === 0 ? (
              <p className="p-5 text-sm text-slate-400">No payments yet. Run an agent and approve a purchase.</p>
            ) : (
              transactions.map((tx) => (
                <PaymentRow
                  key={tx.id}
                  tx={tx}
                  selected={selectedId === tx.id}
                  onSelect={() => setSelectedId(tx.id)}
                />
              ))
            )}
          </div>
        </div>

        <div className="lg:col-span-2">
          {selectedTx?.paynowPayload ? (
            <PayNowReceipt
              payload={selectedTx.paynowPayload}
              title="Settlement detail"
              emptyMessage=""
            />
          ) : selectedTx ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="font-semibold">Settlement detail</h3>
              <p className="mt-2 text-sm text-slate-500">No PayNow payload for this transaction.</p>
              {selectedTx.url && (
                <a
                  href={selectedTx.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 block break-all text-xs text-brand-600 hover:underline"
                >
                  {selectedTx.url}
                </a>
              )}
            </div>
          ) : (
            <PayNowReceipt payload={null} title="Settlement detail" />
          )}
        </div>
      </div>
    </main>
  );
}
