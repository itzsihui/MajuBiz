import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { runAgent } from "../services/agentRunner.js";
import {
  getInventoryItem,
  getState,
  updateInventoryItem,
  updateInventorySettings,
} from "../store.js";

export const inventoryRouter = Router();

inventoryRouter.patch("/inventory/settings", (req, res) => {
  const autoSearchEnabled =
    typeof req.body?.autoSearchEnabled === "boolean" ? req.body.autoSearchEnabled : undefined;

  if (autoSearchEnabled === undefined) {
    res.status(400).json({ error: "autoSearchEnabled boolean is required" });
    return;
  }

  const settings = updateInventorySettings({ autoSearchEnabled });
  res.json({ settings });
});

inventoryRouter.patch("/inventory/:id", async (req, res) => {
  const { id } = req.params;
  const item = getInventoryItem(id);

  if (!item) {
    res.status(404).json({ error: "Inventory item not found" });
    return;
  }

  const currentStock =
    typeof req.body?.currentStock === "number" ? req.body.currentStock : undefined;
  const reorderThreshold =
    typeof req.body?.reorderThreshold === "number" ? req.body.reorderThreshold : undefined;

  if (currentStock === undefined && reorderThreshold === undefined) {
    res.status(400).json({ error: "currentStock or reorderThreshold required" });
    return;
  }

  if (currentStock !== undefined && (currentStock < 0 || !Number.isFinite(currentStock))) {
    res.status(400).json({ error: "currentStock must be a non-negative number" });
    return;
  }

  if (
    reorderThreshold !== undefined &&
    (reorderThreshold < 0 || !Number.isFinite(reorderThreshold))
  ) {
    res.status(400).json({ error: "reorderThreshold must be a non-negative number" });
    return;
  }

  const updated = updateInventoryItem(id, {
    ...(currentStock !== undefined ? { currentStock: Math.round(currentStock) } : {}),
    ...(reorderThreshold !== undefined ? { reorderThreshold: Math.round(reorderThreshold) } : {}),
  });

  if (!updated) {
    res.status(404).json({ error: "Inventory item not found" });
    return;
  }

  const state = getState();
  const isLowStock = updated.currentStock <= updated.reorderThreshold;
  const shouldTrigger =
    isLowStock && state.inventorySettings.autoSearchEnabled && updated.linkedAgentId;

  if (!shouldTrigger) {
    res.json({
      item: updated,
      triggered: false,
      lowStock: isLowStock,
    });
    return;
  }

  const agent = state.agents.find((a) => a.agentId === updated.linkedAgentId);
  if (!agent) {
    res.json({
      item: updated,
      triggered: false,
      lowStock: isLowStock,
      message: "Linked agent not found",
    });
    return;
  }

  if (agent.status === "running") {
    res.json({
      item: updated,
      triggered: false,
      lowStock: isLowStock,
      message: "Linked agent is already running",
    });
    return;
  }

  const runId = uuidv4();
  void runAgent(agent, runId);

  res.json({
    item: updated,
    triggered: true,
    lowStock: true,
    runId,
    agentId: agent.agentId,
    agentName: agent.name,
    message: `Auto-search triggered for ${agent.name}`,
  });
});
