const BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export interface Project {
  id: string;
  name: string;
  targetDir: string;
}

export interface SessionRun {
  sessionId: string;
  pid: number | null;
  startedAt: string;
}

export interface AgentState {
  lastRunAt: string | null;
  sessionId: string | null;
  pid: number | null;
  status: string;
  totalCostUsd: number;
  error?: string;
  activeSessions: SessionRun[];
}

export interface CronTrigger {
  type: "cron";
  schedule: string;
}

export interface LinearWebhookTrigger {
  type: "linear-webhook";
  statusTo?: string[];
  teams?: string[];
  labels?: string[];
}

export type AgentTrigger = CronTrigger | LinearWebhookTrigger;

export interface Agent {
  id: string;
  name: string;
  schedule?: string;
  enabled: boolean;
  permissionMode: string;
  model: string;
  prompt: string;
  triggers: AgentTrigger[];
  state: AgentState;
}

export interface LogEntry {
  timestamp: string;
  type: string;
  message: string;
  sessionId?: string;
}

export interface Domain {
  id: string;
  content: string;
}

export const api = {
  getProjects: () => request<Project[]>("/projects"),
  createProject: (p: Project) =>
    request<Project>("/projects", { method: "POST", body: JSON.stringify(p) }),
  deleteProject: (id: string) =>
    request("/projects/" + id, { method: "DELETE" }),

  getAgents: (pid: string) => request<Agent[]>(`/projects/${pid}/agents`),
  getAgent: (pid: string, aid: string) =>
    request<Agent>(`/projects/${pid}/agents/${aid}`),
  updateAgent: (pid: string, aid: string, data: Record<string, unknown>) =>
    request<Agent>(`/projects/${pid}/agents/${aid}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteAgent: (pid: string, aid: string) =>
    request(`/projects/${pid}/agents/${aid}`, { method: "DELETE" }),
  enableAgent: (pid: string, aid: string) =>
    request<Agent>(`/projects/${pid}/agents/${aid}/enable`, { method: "PUT" }),
  disableAgent: (pid: string, aid: string) =>
    request<Agent>(`/projects/${pid}/agents/${aid}/disable`, { method: "PUT" }),
  triggerAgent: (pid: string, aid: string, issue?: LinearIssue) =>
    request(`/projects/${pid}/agents/${aid}/trigger`, {
      method: "POST",
      body: JSON.stringify(issue ? { issue } : {}),
    }),
  stopAgent: (pid: string, aid: string) =>
    request(`/projects/${pid}/agents/${aid}/stop`, { method: "POST" }),
  getLogs: (pid: string, aid: string, tail = 100, sessionId?: string) =>
    request<LogEntry[]>(`/projects/${pid}/agents/${aid}/logs?tail=${tail}${sessionId ? `&session=${sessionId}` : ""}`),

  getDomains: (pid: string) => request<Domain[]>(`/projects/${pid}/domains`),
  getDomain: (pid: string, did: string) =>
    request<Domain>(`/projects/${pid}/domains/${did}`),
  updateDomain: (pid: string, did: string, content: string) =>
    request<Domain>(`/projects/${pid}/domains/${did}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    }),
  deleteDomain: (pid: string, did: string) =>
    request(`/projects/${pid}/domains/${did}`, { method: "DELETE" }),

  getIssues: (pid: string) => request<LinearIssue[]>(`/projects/${pid}/issues`),
  chatIssue: (pid: string, identifier: string, issue: LinearIssue, model?: string) =>
    request<{ ok: boolean; sessionId: string; agentId: string }>(
      `/projects/${pid}/issues/${identifier}/chat`,
      { method: "POST", body: JSON.stringify({ issue, model }) },
    ),
  sendIssueMessage: (pid: string, identifier: string, message: string, model?: string) =>
    request<{ ok: boolean }>(
      `/projects/${pid}/issues/${identifier}/message`,
      { method: "POST", body: JSON.stringify({ message, model }) },
    ),
  stopIssue: (pid: string, identifier: string) =>
    request(`/projects/${pid}/issues/${identifier}/stop`, { method: "POST" }),
  updateIssueStatus: (pid: string, identifier: string, stateId: string) =>
    request<{ ok: boolean }>(`/projects/${pid}/issues/${identifier}/status`, {
      method: "PUT",
      body: JSON.stringify({ stateId }),
    }),
  getIssueSessions: (pid: string) =>
    request<IssueSession[]>(`/projects/${pid}/issues/sessions`),
};

export interface IssueSession {
  identifier: string;
  agentId: string;
  sessionId: string;
  busy: boolean;
}

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  url: string;
  priority: number;
  priorityLabel: string;
  state: { id: string; name: string; type: string };
  team: { key: string; name: string; states: { nodes: { id: string; name: string; type: string }[] } };
  assignee?: { name: string; email: string; avatarUrl?: string };
  labels: { nodes: { name: string; color: string }[] };
  updatedAt: string;
  createdAt: string;
  session: { running: boolean; sessionId: string | null };
}
