export interface Project {
  id: string;
  name: string;
  targetDir: string;
  dockerImage?: string;
}

export interface RunnerConfig {
  projects: Project[];
}

export interface CronTrigger {
  type: "cron";
  schedule: string;
}

export interface LinearWebhookTrigger {
  type: "linear-webhook";
  /** Which status transition(s) fire this agent — matches the "to" state name */
  statusTo?: string[];
  /** Optional: only fire for issues in these team keys (e.g. ["ENG", "PLATFORM"]) */
  teams?: string[];
  /** Optional: only fire for these label names */
  labels?: string[];
  /** Optional: only fire for issues in these Linear project names (e.g. ["Gobi Monorepo"]) */
  projects?: string[];
}

export type AgentTrigger = CronTrigger | LinearWebhookTrigger;

export type AgentTool = "linear" | "sentry" | "langfuse" | "gcloud";

export interface AgentFrontmatter {
  name: string;
  schedule?: string;
  enabled: boolean;
  permissionMode: string;
  model: string;
  tools?: AgentTool[];
  triggers?: AgentTrigger[];
}

export interface AgentConfig extends AgentFrontmatter {
  id: string; // filename without .md
  prompt: string;
  filePath: string;
  /** Extra context injected at trigger time (e.g. Linear issue payload) */
  triggerContext?: string;
}

export interface AgentState {
  lastRunAt: string | null;
  sessionId: string | null;
  pid: number | null;
  status: "idle" | "running" | "completed" | "stopped" | "errored" | "skipped";
  totalCostUsd: number;
  error?: string;
}

export interface AgentWithState extends AgentConfig {
  state: AgentState;
}

export interface ProjectState {
  [agentId: string]: AgentState;
}

export interface LogEntry {
  timestamp: string;
  agentId: string;
  projectId: string;
  type: "info" | "error" | "output" | "system";
  message: string;
}
