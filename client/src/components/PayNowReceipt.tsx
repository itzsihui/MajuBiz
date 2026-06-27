import { useState } from "react";
import type { PayNowPayload } from "../lib/api";

interface PayNowReceiptProps {
  payload: PayNowPayload | null;
  title?: string;
  emptyMessage?: string;
}

export function PayNowReceipt({
  payload,
  title = "Latest transaction",
  emptyMessage = "Approve a purchase to see your most recent PayNow receipt.",
}: PayNowReceiptProps) {
  const [showJson, setShowJson] = useState(false);

  if (!payload) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-2 font-semibold">{title}</h3>
        <p className="text-sm text-slate-500">{emptyMessage}</p>
      </div>
    );
  }

  const line = payload.structuredRemittance.lineItems[0];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold">{title}</h3>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            payload.status === "COMPLETED"
              ? "bg-emerald-50 text-emerald-700"
              : "bg-amber-50 text-amber-700"
          }`}
        >
          {payload.status}
        </span>
      </div>

      <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 text-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-slate-500">Paid to</p>
            <p className="font-medium text-slate-900">{payload.creditor.name}</p>
            <p className="text-xs text-slate-500">UEN {payload.creditor.uen}</p>
          </div>
          <p className="text-xl font-bold text-brand-700">S${payload.amount.value.toFixed(2)}</p>
        </div>
        {line && (
          <p className="mt-3 text-xs text-slate-600">
            {line.quantity} {line.unit} {line.description} @ S${line.unitPrice.toFixed(2)}
          </p>
        )}
        {payload.debtor && (
          <p className="mt-3 text-xs text-slate-600">
            <span className="text-slate-500">From </span>
            {payload.debtor.businessName}
            {payload.debtor.uen ? ` · UEN ${payload.debtor.uen}` : ""}
          </p>
        )}
        {payload.shipping && (
          <p className="mt-1 text-xs text-slate-600">
            <span className="text-slate-500">Ship to </span>
            {[
              payload.shipping.addressLine1,
              payload.shipping.addressLine2,
              `${payload.shipping.city} ${payload.shipping.postalCode}`,
              payload.shipping.country,
            ]
              .filter(Boolean)
              .join(", ")}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-500">
          <span className="rounded bg-white px-2 py-0.5 ring-1 ring-slate-200">
            Ref {payload.transactionRef}
          </span>
          <span className="rounded bg-white px-2 py-0.5 ring-1 ring-slate-200">
            {payload.structuredRemittance.invoiceNumber}
          </span>
        </div>
        {payload.settledAt && (
          <p className="mt-2 text-[11px] text-emerald-700">
            Settled {new Date(payload.settledAt).toLocaleString("en-SG")}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={() => setShowJson((v) => !v)}
        className="mt-3 text-xs font-medium text-slate-500 hover:text-slate-700"
      >
        {showJson ? "Hide" : "Show"} Gen 2 payload JSON
      </button>
      {showJson && (
        <pre className="mt-2 max-h-48 overflow-auto rounded-xl bg-slate-900 p-3 text-[10px] text-emerald-300">
          {JSON.stringify(payload, null, 2)}
        </pre>
      )}
    </div>
  );
}
