import { Router } from "express";
import { getPendingRunContext } from "../services/runApproval.js";
import { buildPayNowPreview } from "../services/paynowSettlementSimulator.js";

export const paynowRouter = Router();

/** Preview for bank confirmation modal before approval */
paynowRouter.get("/runs/:runId/paynow-preview", (req, res) => {
  const ctx = getPendingRunContext(req.params.runId);
  if (!ctx) {
    res.status(404).json({ error: "No pending purchase for this run" });
    return;
  }

  res.json(buildPayNowPreview(ctx.agent, ctx.scrape));
});
