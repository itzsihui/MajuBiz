import type { Transaction } from "./api";

function csvCell(value: string | number | undefined | null): string {
  const raw = value == null ? "" : String(value);
  if (/[",\n\r]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
  return raw;
}

export function exportPaymentsToCsv(transactions: Transaction[]): void {
  const headers = [
    "Date",
    "Agent",
    "Description",
    "Amount (SGD)",
    "Status",
    "Seller",
    "UEN",
    "PayNow Ref",
    "Invoice",
    "Reconciliation Ref",
    "Source",
    "Listing URL",
  ];

  const rows = transactions.map((tx) => {
    const p = tx.paynowPayload;
    return [
      new Date(tx.createdAt).toLocaleString("en-SG"),
      tx.agentName,
      tx.description,
      tx.amount.toFixed(2),
      tx.status,
      p?.creditor.name ?? "",
      p?.creditor.uen ?? "",
      p?.transactionRef ?? "",
      p?.structuredRemittance.invoiceNumber ?? "",
      p?.structuredRemittance.reconciliationRef ?? "",
      tx.source,
      tx.url ?? "",
    ].map(csvCell);
  });

  const csv = [headers.map(csvCell).join(","), ...rows.map((r) => r.join(","))].join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `majubiz-payments-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
