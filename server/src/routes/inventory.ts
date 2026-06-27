import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { runAgent } from "../services/agentRunner.js";
import {
  getInventoryItem,
  getState,
  resolveRestockAgent,
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
  const maxUnitPrice =
    typeof req.body?.maxUnitPrice === "number" ? req.body.maxUnitPrice : undefined;

  if (currentStock === undefined && reorderThreshold === undefined && maxUnitPrice === undefined) {
    res.status(400).json({ error: "currentStock, reorderThreshold, or maxUnitPrice required" });
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

  if (maxUnitPrice !== undefined && (maxUnitPrice <= 0 || !Number.isFinite(maxUnitPrice))) {
    res.status(400).json({ error: "maxUnitPrice must be a positive number" });
    return;
  }

  const updated = updateInventoryItem(id, {
    ...(currentStock !== undefined ? { currentStock: Math.round(currentStock) } : {}),
    ...(reorderThreshold !== undefined ? { reorderThreshold: Math.round(reorderThreshold) } : {}),
    ...(maxUnitPrice !== undefined ? { maxUnitPrice: Math.round(maxUnitPrice * 100) / 100 } : {}),
  });

  if (!updated) {
    res.status(404).json({ error: "Inventory item not found" });
    return;
  }

  const state = getState();
  const isLowStock = updated.currentStock <= updated.reorderThreshold;
  const autoSearchOn = state.inventorySettings.autoSearchEnabled;

  if (!isLowStock || !autoSearchOn) {
    res.json({
      item: updated,
      triggered: false,
      lowStock: isLowStock,
      ...(isLowStock && !autoSearchOn
        ? { message: "Low stock — turn on auto-search to restock automatically." }
        : {}),
    });
    return;
  }

  const freshItem = getInventoryItem(id)!;
  const { agent, autoLinked, created } = resolveRestockAgent(freshItem);

  if (agent.status === "running") {
    res.json({
      item: getInventoryItem(id),
      triggered: false,
      lowStock: true,
      agentId: agent.agentId,
      agentName: agent.name,
      message: `${agent.name} is already running`,
    });
    return;
  }

  const runId = uuidv4();
  void runAgent(agent, runId);

  const linkedItem = getInventoryItem(id);
  let message = `Auto-search started for ${agent.name}`;
  if (created) {
    message = `Created ${agent.name} and started search`;
  } else if (autoLinked) {
    message = `Matched ${agent.name} and started search`;
  }

  res.json({
    item: linkedItem,
    triggered: true,
    lowStock: true,
    runId,
    agentId: agent.agentId,
    agentName: agent.name,
    agent,
    autoLinked,
    agentCreated: created,
    message,
  });
});
