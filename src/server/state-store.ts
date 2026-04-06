import fs from "fs";
import path from "path";
import type { Response } from "express";
import type { AgentState, ProjectState } from "./types.js";
import { getRunnerDir } from "./project-resolver.js";

// SSE clients for agent state changes, keyed by projectId
const stateClients = new Map<string, Set<Response>>();

export function addStateClient(projectId: string, res: Response): void {
  if (!stateClients.has(projectId)) stateClients.set(projectId, new Set());
  stateClients.get(projectId)!.add(res);
}

export function removeStateClient(projectId: string, res: Response): void {
  stateClients.get(projectId)?.delete(res);
  if (stateClients.get(projectId)?.size === 0) stateClients.delete(projectId);
}

function emitStateChange(projectId: string, agentId: string, state: AgentState): void {
  const clients = stateClients.get(projectId);
  if (!clients) return;
  const data = JSON.stringify({ agentId, state });
  for (const res of clients) {
    res.write(`data: ${data}\n\n`);
  }
}

function stateFilePath(projectId: string): string {
  return path.join(getRunnerDir(projectId), "state.json");
}

export function defaultAgentState(): AgentState {
  return {
    lastRunAt: null,
    sessionId: null,
    pid: null,
    status: "idle",
    totalCostUsd: 0,
    activeSessions: [],
  };
}

export function loadProjectState(projectId: string): ProjectState {
  const fp = stateFilePath(projectId);
  if (!fs.existsSync(fp)) return {};
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8"));
  } catch {
    return {};
  }
}

export function saveProjectState(
  projectId: string,
  state: ProjectState
): void {
  const fp = stateFilePath(projectId);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(state, null, 2));
}

export function getAgentState(
  projectId: string,
  agentId: string
): AgentState {
  const state = loadProjectState(projectId);
  return state[agentId] || defaultAgentState();
}

export function updateAgentState(
  projectId: string,
  agentId: string,
  update: Partial<AgentState>
): AgentState {
  const state = loadProjectState(projectId);
  const current = state[agentId] || defaultAgentState();
  const updated = { ...current, ...update };
  state[agentId] = updated;
  saveProjectState(projectId, state);
  emitStateChange(projectId, agentId, updated);
  return updated;
}
