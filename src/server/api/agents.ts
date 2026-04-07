import { Router, type Request, type Response } from "express";
import fs from "fs";
import path from "path";
import type { RunnerConfig, AgentWithState, AgentFrontmatter } from "../types.js";
import { loadAllAgents, loadAgent, saveAgent, deleteAgentFile } from "../agent-loader.js";
import { getAgentState, updateAgentState, defaultAgentState, addStateClient, removeStateClient } from "../state-store.js";
import { loadExecutions } from "../execution-store.js";
import { executeAgent, stopAgent } from "../session-manager.js";
import { scheduleAgent, unscheduleAgent } from "../scheduler.js";
import { getQueueStatus } from "../issue-queue.js";

const router = Router();
const RUNNER_JSON = path.join(process.cwd(), "runner.json");

function getProject(projectId: string) {
  const config: RunnerConfig = JSON.parse(
    fs.readFileSync(RUNNER_JSON, "utf-8")
  );
  return config.projects.find((p) => p.id === projectId);
}

// GET /api/projects/:pid/agents
router.get("/:pid/agents", (req: Request, res: Response) => {
  const project = getProject(req.params.pid);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const agents = loadAllAgents(project.id);
  const result: AgentWithState[] = agents.map((a) => ({
    ...a,
    state: getAgentState(project.id, a.id),
  }));
  res.json(result);
});

// GET /api/projects/:pid/agents/stream — SSE for agent state changes
router.get("/:pid/agents/stream", (req: Request, res: Response) => {
  const projectId = req.params.pid;
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
  addStateClient(projectId, res);
  req.on("close", () => removeStateClient(projectId, res));
});

// GET /api/projects/:pid/agents/:aid
router.get("/:pid/agents/:aid", (req: Request, res: Response) => {
  const project = getProject(req.params.pid);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  try {
    const agent = loadAgent(project.id, `${req.params.aid}.md`);
    const state = getAgentState(project.id, agent.id);
    res.json({ ...agent, state });
  } catch {
    res.status(404).json({ error: "Agent not found" });
  }
});

// POST /api/projects/:pid/agents — create new agent
router.post("/:pid/agents", (req: Request, res: Response) => {
  const project = getProject(req.params.pid);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const { id, name, schedule, enabled, provider, permissionMode, model, prompt, triggers } = req.body;
  if (!id || !prompt) {
    res.status(400).json({ error: "id and prompt are required" });
    return;
  }
  const frontmatter: AgentFrontmatter = {
    name: name || id,
    schedule: schedule || "",
    enabled: enabled ?? false,
    provider: provider || "claude",
    permissionMode: permissionMode || "default",
    model: model || "",
    triggers: triggers ?? [],
  };
  saveAgent(project.id, id, frontmatter, prompt);

  const agent = loadAgent(project.id, `${id}.md`);
  if (agent.enabled) {
    scheduleAgent(project, agent);
  }

  res.status(201).json({ ...agent, state: defaultAgentState() });
});

// PUT /api/projects/:pid/agents/:aid — update agent
router.put("/:pid/agents/:aid", (req: Request, res: Response) => {
  const project = getProject(req.params.pid);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const { name, schedule, enabled, provider, permissionMode, model, prompt, triggers } = req.body;
  // Preserve existing triggers if not provided in the request
  let resolvedTriggers = triggers;
  if (resolvedTriggers === undefined) {
    try {
      const existing = loadAgent(project.id, `${req.params.aid}.md`);
      resolvedTriggers = existing.triggers ?? [];
    } catch {
      resolvedTriggers = [];
    }
  }
  const frontmatter: AgentFrontmatter = {
    name: name || req.params.aid,
    schedule: schedule || "",
    enabled: enabled ?? false,
    provider: provider || "claude",
    permissionMode: permissionMode || "default",
    model: model || "",
    triggers: resolvedTriggers,
  };
  saveAgent(project.id, req.params.aid, frontmatter, prompt || "");

  const agent = loadAgent(project.id, `${req.params.aid}.md`);
  if (agent.enabled) {
    scheduleAgent(project, agent);
  } else {
    unscheduleAgent(project.id, agent.id);
  }

  res.json({ ...agent, state: getAgentState(project.id, agent.id) });
});

// DELETE /api/projects/:pid/agents/:aid
router.delete("/:pid/agents/:aid", (req: Request, res: Response) => {
  const project = getProject(req.params.pid);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  unscheduleAgent(project.id, req.params.aid);
  stopAgent(project.id, req.params.aid);
  deleteAgentFile(project.id, req.params.aid);
  res.json({ ok: true });
});

// PUT /api/projects/:pid/agents/:aid/enable
router.put("/:pid/agents/:aid/enable", (req: Request, res: Response) => {
  const project = getProject(req.params.pid);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  try {
    const agent = loadAgent(project.id, `${req.params.aid}.md`);
    saveAgent(project.id, agent.id, { ...agent, enabled: true }, agent.prompt);
    const updated = loadAgent(project.id, `${agent.id}.md`);
    scheduleAgent(project, updated);
    res.json({ ...updated, state: getAgentState(project.id, updated.id) });
  } catch {
    res.status(404).json({ error: "Agent not found" });
  }
});

// PUT /api/projects/:pid/agents/:aid/disable
router.put("/:pid/agents/:aid/disable", (req: Request, res: Response) => {
  const project = getProject(req.params.pid);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  try {
    const agent = loadAgent(project.id, `${req.params.aid}.md`);
    saveAgent(project.id, agent.id, { ...agent, enabled: false }, agent.prompt);
    unscheduleAgent(project.id, agent.id);
    stopAgent(project.id, agent.id);
    const updated = loadAgent(project.id, `${agent.id}.md`);
    res.json({ ...updated, state: getAgentState(project.id, updated.id) });
  } catch {
    res.status(404).json({ error: "Agent not found" });
  }
});

// POST /api/projects/:pid/agents/:aid/trigger
// Body: optional { issue: { identifier, title, description, state, team, assignee, labels, url } }
router.post("/:pid/agents/:aid/trigger", (req: Request, res: Response) => {
  const project = getProject(req.params.pid);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  try {
    const agent = loadAgent(project.id, `${req.params.aid}.md`);

    // If an issue is provided, inject it as trigger context (same as webhook)
    const issue = req.body?.issue;
    if (issue) {
      const lines: string[] = [
        `## Linear Issue Trigger`,
        ``,
        `This agent was manually triggered for a Linear issue.`,
        ``,
        `- **Issue:** ${issue.identifier ?? issue.id} — ${issue.title ?? "(no title)"}`,
        `- **Status:** ${issue.state?.name ?? "(unknown)"}`,
      ];
      if (issue.team) lines.push(`- **Team:** ${issue.team.key} (${issue.team.name})`);
      if (issue.assignee) lines.push(`- **Assignee:** ${issue.assignee.name}`);
      if (issue.url) lines.push(`- **URL:** ${issue.url}`);
      if (issue.labels?.nodes?.length) {
        lines.push(`- **Labels:** ${issue.labels.nodes.map((l: any) => l.name).join(", ")}`);
      }
      if (issue.description) {
        lines.push(``, `### Description`, ``, issue.description);
      }
      const agentWithContext = { ...agent, triggerContext: lines.join("\n") };
      executeAgent(project, agentWithContext);
    } else {
      executeAgent(project, agent);
    }

    res.json({ ok: true, state: getAgentState(project.id, agent.id) });
  } catch (e) {
    res.status(404).json({ error: "Agent not found" });
  }
});

// POST /api/projects/:pid/agents/:aid/stop
router.post("/:pid/agents/:aid/stop", (req: Request, res: Response) => {
  const stopped = stopAgent(req.params.pid, req.params.aid);
  res.json({ ok: stopped });
});

// GET /api/projects/:pid/queue — pending queue items
router.get("/:pid/queue", (_req: Request, res: Response) => {
  const status = getQueueStatus();
  res.json(status.pending);
});

// GET /api/projects/:pid/executions — execution history across all agents, newest first
router.get("/:pid/executions", (req: Request, res: Response) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
  const records = loadExecutions(req.params.pid);
  res.json(records.slice(0, limit));
});

export default router;
