import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import {
  addAgent,
  getRunEvents,
  getState,
  subscribeRun,
} from "../store.js";
import { parseAgentPrompt } from "../services/parseAgent.js";
import { runAgent } from "../services/agentRunner.js";
import type { Agent } from "../types.js";

export const agentsRouter = Router();

agentsRouter.get("/state", (_req, res) => {
  res.json(getState());
});

agentsRouter.post("/agents/parse", async (req, res) => {
  const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
  if (!prompt) {
    res.status(400).json({ error: "prompt is required" });
    return;
  }

  const { config, provider } = await parseAgentPrompt(prompt);
  const agent: Agent = {
    agentId: `agt_${uuidv4().slice(0, 8)}`,
    ...config,
    action: "auto_purchase",
    status: "ready",
    prompt,
    createdAt: new Date().toISOString(),
  };
  addAgent(agent);

  res.json({
    agent,
    parseProvider: provider,
    message:
      provider === "openai"
        ? "Parsed by GPT-4o-mini"
        : "Parsed by rule engine (OpenAI unavailable)",
  });
});

agentsRouter.post("/agents/:id/run", async (req, res) => {
  const { id } = req.params;
  const state = getState();
  const agent = state.agents.find((a) => a.agentId === id);

  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  if (agent.status === "running") {
    res.status(409).json({ error: "Agent is already running" });
    return;
  }

  const runId = uuidv4();
  void runAgent(agent, runId);
  res.status(202).json({ runId, status: "started" });
});

agentsRouter.get("/agents/:id/events", (req, res) => {
  const runId = typeof req.query.runId === "string" ? req.query.runId : "";
  if (!runId) {
    res.status(400).json({ error: "runId query param required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const existing = getRunEvents(runId);
  for (const ev of existing) {
    res.write(`data: ${JSON.stringify(ev)}\n\n`);
  }

  const unsubscribe = subscribeRun(runId, (ev) => {
    res.write(`data: ${JSON.stringify(ev)}\n\n`);
    if (ev.step === "complete" || ev.step === "no_match" || ev.step === "error") {
      res.write(`data: ${JSON.stringify({ ...ev, step: "stream_end" })}\n\n`);
      unsubscribe();
      res.end();
    }
  });

  req.on("close", () => unsubscribe());
});
