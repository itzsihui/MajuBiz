import { Loader2, Shield, X } from "lucide-react";
import type { PayNowPreview } from "../lib/api";

function formatMoney(amount: number) {
  return `S$${amount.toFixed(2)}`;
}

interface PayNowBankModalProps {
  open: boolean;
  preview: PayNowPreview | null;
  loading: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function PayNowBankModal({ open, preview, loading, onClose, onConfirm }: PayNowBankModalProps) {
  if (!open || !preview) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-4 sm:items-center">
      <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="bg-gradient-to-br from-[#c41230] to-[#8b0f24] px-5 py-4 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15">
                <Shield className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold">PayNow</p>
                <p className="text-[10px] text-white/70">DBS PayLah! · Simulated</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="rounded-lg p-1 text-white/80 hover:bg-white/10 disabled:opacity-50"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="space-y-4 p-5">
          <div className="text-center">
            <p className="text-xs text-slate-500">You are paying</p>
            <p className="mt-1 text-3xl font-bold text-slate-900">{formatMoney(preview.amount)}</p>
            <p className="mt-1 text-xs text-slate-500">via PayNow Gen 2 · REQUEST_TO_PAY</p>
          </div>

          <div className="space-y-2 rounded-xl bg-slate-50 p-4 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-slate-500">Payee</span>
              <span className="text-right font-medium text-slate-900">{preview.creditorName}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-slate-500">UEN</span>
              <span className="font-mono text-xs text-slate-800">{preview.creditorUen}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-slate-500">Reference</span>
              <span className="font-mono text-xs text-slate-800">{preview.reconciliationRef}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-slate-500">For</span>
              <span className="text-right text-slate-800">
                {preview.quantity} {preview.unit} · {preview.product}
              </span>
            </div>
            <div className="flex justify-between gap-4 border-t border-slate-200 pt-2">
              <span className="text-slate-500">Invoice</span>
              <span className="font-mono text-xs text-slate-800">{preview.invoiceNumber}</span>
            </div>
            {preview.debtorName && (
              <div className="flex justify-between gap-4">
                <span className="text-slate-500">From</span>
                <span className="text-right text-slate-800">{preview.debtorName}</span>
              </div>
            )}
            {preview.shipTo && (
              <div className="flex justify-between gap-4">
                <span className="shrink-0 text-slate-500">Ship to</span>
                <span className="text-right text-xs text-slate-800">{preview.shipTo}</span>
              </div>
            )}
          </div>

          <p className="text-center text-[11px] leading-relaxed text-slate-400">
            Simulated bank approval — settlement runs on MajuBiz PayNow Gen 2 rail after you confirm.
          </p>

          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#c41230] py-3.5 text-sm font-semibold text-white hover:bg-[#a30f28] disabled:opacity-60"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Processing…
              </>
            ) : (
              "Confirm payment"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
