export interface Project {
  id: string;
  name: string;
  targetDir: string;
  dockerImage?: string;
}

/** Per-project config stored at <targetDir>/.runner/config.json */
export interface ProjectConfig {
  /** GitHub repos to clone into agent containers (full "org/repo" paths) */
  githubRepos?: string[];
  /** Local directories to mount read-only into agent containers */
  localDirs?: string[];
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
  /** Optional: only fire for issues in these Linear project names (e.g. ["My Project"]) */
  projects?: string[];
}

export type AgentTrigger = CronTrigger | LinearWebhookTrigger;

export type AgentTool = "linear" | "sentry" | "langfuse" | "gcloud";

export interface AgentFrontmatter {
  name: string;
  schedule?: string;
  enabled: boolean;
  provider?: string; // "claude" | "copilot", defaults to "claude"
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
  /** Host directory containing downloaded issue attachments (images) */
  attachmentsDir?: string;
  /** Linear issue identifier (e.g. "ENG-123") when triggered from a webhook */
  linearIdentifier?: string;
}

export interface SessionRun {
  sessionId: string;
  pid: number | null;
  startedAt: string;
  agentName?: string;
  linearIdentifier?: string;
}

export interface ExecutionRecord {
  sessionId: string;
  agentId: string;
  agentName: string;
  startedAt: string;
  finishedAt: string;
  status: "completed" | "errored" | "stopped";
  linearIdentifier?: string;
  costUsd?: number;
}

export interface AgentState {
  lastRunAt: string | null;
  sessionId: string | null;
  pid: number | null;
  status: "idle" | "running" | "completed" | "stopped" | "errored" | "skipped";
  totalCostUsd: number;
  error?: string;
  /** All currently running sessions for this agent (supports concurrent runs) */
  activeSessions: SessionRun[];
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
  sessionId?: string;
}
