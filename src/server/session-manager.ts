import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import type { AgentConfig, AgentState, Project } from "./types.js";
import { updateAgentState, getAgentState, loadProjectState, saveProjectState } from "./state-store.js";
import { appendLog, emitLogEvent, setActiveSession, clearActiveSession } from "./api/logs.js";

// Keyed by "projectId:agentId:sessionId" to support multiple concurrent sessions
const activeProcesses = new Map<string, ChildProcess>();

function sessionKey(projectId: string, agentId: string, sessionId: string): string {
  return `${projectId}:${agentId}:${sessionId}`;
}

function formatToolInput(name: string, input: Record<string, unknown>): string {
  // Show the most useful field(s) per tool
  switch (name) {
    case "Read":
      return input.file_path ? String(input.file_path) : "";
    case "Write":
      return input.file_path ? String(input.file_path) : "";
    case "Edit":
      return input.file_path ? String(input.file_path) : "";
    case "Glob":
      return input.pattern ? String(input.pattern) : "";
    case "Grep":
      return [input.pattern, input.path].filter(Boolean).join(" in ") || "";
    case "Bash":
      return input.command ? String(input.command).slice(0, 120) : "";
    case "Agent":
      return input.description ? String(input.description) : "";
    default: {
      // For MCP tools and others, show key=value pairs compactly
      const parts = Object.entries(input)
        .filter(([_, v]) => v !== undefined && v !== null && v !== "")
        .map(([k, v]) => {
          const s = typeof v === "string" ? v : JSON.stringify(v);
          return `${k}=${s.length > 80 ? s.slice(0, 80) + "..." : s}`;
        });
      return parts.join(", ").slice(0, 200);
    }
  }
}

function processKey(projectId: string, agentId: string): string {
  return `${projectId}:${agentId}`;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function buildDockerArgs(
  project: Project,
  agent: AgentConfig,
  sessionId: string
): string[] {
  const image = project.dockerImage ?? "gobi-runner:latest";
  const home = process.env.HOME ?? "/root";
  return [
    "run", "--rm",
    "--name", `agent-${agent.id}-${sessionId}`,
    "-e", `AGENT=${agent.id}`,
    "-e", `SESSION_ID=${sessionId}`,
    "-e", `PERMISSION_MODE=${agent.permissionMode}`,
    "-e", `MODEL=${agent.model ?? ""}`,
    "-e", `LINEAR_API_KEY=${process.env.LINEAR_API_KEY ?? ""}`,
    "-e", `ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY ?? ""}`,
    "-e", `GITHUB_ORG=${process.env.GITHUB_ORG ?? "gobi-ai"}`,
    "-e", `AGENT_TOOLS=${(agent.tools ?? []).join(",")}`,
    // Langfuse credentials (only used when tools includes "langfuse")
    "-e", `LANGFUSE_PUBLIC_KEY=${process.env.LANGFUSE_PUBLIC_KEY ?? ""}`,
    "-e", `LANGFUSE_SECRET_KEY=${process.env.LANGFUSE_SECRET_KEY ?? ""}`,
    "-e", `LANGFUSE_HOST=${process.env.LANGFUSE_HOST ?? "https://cloud.langfuse.com"}`,
    // Agent prompt files
    "-v", `${project.targetDir}/.runner/agents:/agents:ro`,
    // Shared MD files (CLAUDE.md, LINEAR.md, approvers/, actors/)
    "-v", `${project.targetDir}:/source:ro`,
    // Host git credentials — used for pull inside container
    "-v", `${home}/.gitconfig:/home/agent/.gitconfig:ro`,
    "-v", `${home}/.git-credentials:/home/agent/.git-credentials:ro`,
    "-v", `${home}/.ssh:/home/agent/.ssh:ro`,
    // gh auth state — needed for 'gh auth git-credential' referenced in .gitconfig
    "-v", `${home}/.config/gh:/home/agent/.config/gh:ro`,
    // Mount ~/.claude so session resume works across container runs
    "-v", `${home}/.claude:/home/agent/.claude`,
    // .claude.json lives at home root, not inside .claude/
    "-v", `${home}/.claude.json:/home/agent/.claude.json`,
    // Sentry MCP auth state — cached OAuth tokens for @sentry/mcp-server
    ...(fs.existsSync(`${home}/.sentry`) ? ["-v", `${home}/.sentry:/home/agent/.sentry:ro`] : []),
    // GCP service account key for gcloud (entrypoint handles activation)
    ...(fs.existsSync(`${home}/.config/gcloud/service-account.json`) ? ["-v", `${home}/.config/gcloud/service-account.json:/home/agent/.config/gcloud/service-account.json:ro`] : []),
    image,
  ];
}

export function startNewSession(
  project: Project,
  agent: AgentConfig
): void {
  const sessionId = uuidv4();
  const sKey = sessionKey(project.id, agent.id, sessionId);

  setActiveSession(project.id, agent.id, sessionId);

  const args = buildDockerArgs(project, agent, sessionId);

  // If webhook trigger context exists, write it to a temp file and mount it
  let triggerFile: string | undefined;
  if (agent.triggerContext) {
    triggerFile = path.join(os.tmpdir(), `trigger-${sessionId}.md`);
    fs.writeFileSync(triggerFile, agent.triggerContext);
    // Insert volume mount before the image name (last element)
    const imgIdx = args.length - 1;
    args.splice(imgIdx, 0, "-v", `${triggerFile}:/tmp/trigger-context.md:ro`);
  }

  // If attachments were downloaded, mount the directory into the container
  if (agent.attachmentsDir && fs.existsSync(agent.attachmentsDir)) {
    const imgIdx = args.length - 1;
    args.splice(imgIdx, 0, "-v", `${agent.attachmentsDir}:/tmp/attachments:ro`);
  }

  const log = (type: "info" | "error" | "output" | "system", message: string) => {
    appendLog(project.id, agent.id, sessionId, type, message);
    emitLogEvent(project.id, agent.id, sessionId, { type, message, timestamp: new Date().toISOString(), agentId: agent.id, projectId: project.id, sessionId });
  };

  log("system", `Starting new session ${sessionId}`);

  const child = spawn("docker", args, {
    cwd: project.targetDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });

  activeProcesses.set(sKey, child);

  // Add to activeSessions array
  const current = getAgentState(project.id, agent.id);
  const newSession = { sessionId, pid: child.pid || null, startedAt: new Date().toISOString() };
  updateAgentState(project.id, agent.id, {
    lastRunAt: new Date().toISOString(),
    sessionId,
    pid: child.pid || null,
    status: "running",
    error: undefined,
    activeSessions: [...(current.activeSessions || []), newSession],
  });

  child.stdout?.on("data", (data: Buffer) => {
    const text = data.toString();
    for (const line of text.split("\n").filter(Boolean)) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === "assistant" && parsed.message?.content) {
          for (const block of parsed.message.content) {
            if (block.type === "text") {
              log("output", block.text);
            } else if (block.type === "tool_use") {
              const input = block.input || {};
              const summary = formatToolInput(block.name, input);
              log("output", summary ? `[tool: ${block.name}] ${summary}` : `[tool: ${block.name}]`);
            }
          }
        } else if (parsed.type === "result") {
          const runCost = parsed.cost_usd ?? 0;
          log("info", `Session completed. Cost: $${Number(runCost).toFixed(6)}`);
          if (runCost > 0) {
            const current = getAgentState(project.id, agent.id);
            updateAgentState(project.id, agent.id, {
              totalCostUsd: (current.totalCostUsd || 0) + runCost,
            });
          }
        }
      } catch {
        log("output", line);
      }
    }
  });

  child.stderr?.on("data", (data: Buffer) => {
    log("error", data.toString());
  });

  child.on("close", (code) => {
    activeProcesses.delete(sKey);
    if (triggerFile) try { fs.unlinkSync(triggerFile); } catch {}
    const status = code === 0 ? "completed" : "errored";
    log("system", `Process exited with code ${code}`);
    log("system", `--- SESSION FINISHED (${status}) ---`);
    clearActiveSession(project.id, agent.id, sessionId);

    // Remove this session from activeSessions
    const latest = getAgentState(project.id, agent.id);
    const remaining = (latest.activeSessions || []).filter((s) => s.sessionId !== sessionId);
    updateAgentState(project.id, agent.id, {
      status: remaining.length > 0 ? "running" : status,
      pid: remaining.length > 0 ? remaining[remaining.length - 1].pid : null,
      sessionId: remaining.length > 0 ? remaining[remaining.length - 1].sessionId : sessionId,
      activeSessions: remaining,
      error: code !== 0 && remaining.length === 0 ? `Exit code ${code}` : undefined,
    });
  });
}

export function executeAgent(project: Project, agent: AgentConfig): void {
  // Always start a new session — multiple concurrent sessions are supported
  startNewSession(project, agent);
}

export function stopAgent(projectId: string, agentId: string, targetSessionId?: string): boolean {
  const state = getAgentState(projectId, agentId);
  let stopped = false;

  // Stop specific session or all sessions
  const sessionsToStop = targetSessionId
    ? (state.activeSessions || []).filter((s) => s.sessionId === targetSessionId)
    : (state.activeSessions || []);

  for (const session of sessionsToStop) {
    const sKey = sessionKey(projectId, agentId, session.sessionId);
    const child = activeProcesses.get(sKey);
    if (child) {
      child.kill("SIGTERM");
      activeProcesses.delete(sKey);
      stopped = true;
    } else if (session.pid && isProcessAlive(session.pid)) {
      try { process.kill(session.pid, "SIGTERM"); } catch { /* already dead */ }
      stopped = true;
    }
    clearActiveSession(projectId, agentId, session.sessionId);
  }

  // Also try legacy single-PID fallback
  if (!stopped && !targetSessionId) {
    const legacyKey = processKey(projectId, agentId);
    const child = activeProcesses.get(legacyKey);
    if (child) {
      child.kill("SIGTERM");
      activeProcesses.delete(legacyKey);
      stopped = true;
    } else if (state.pid && isProcessAlive(state.pid)) {
      try { process.kill(state.pid, "SIGTERM"); } catch { /* already dead */ }
      stopped = true;
    }
  }

  if (stopped || state.status === "running") {
    const remaining = targetSessionId
      ? (state.activeSessions || []).filter((s) => s.sessionId !== targetSessionId)
      : [];
    updateAgentState(projectId, agentId, {
      status: remaining.length > 0 ? "running" : "stopped",
      pid: remaining.length > 0 ? remaining[remaining.length - 1].pid : null,
      activeSessions: remaining,
    });
    return true;
  }

  return false;
}

export function reconcileStates(
  projects: { id: string; targetDir: string }[]
): void {
  for (const project of projects) {
    const state = loadProjectState(project.id);
    let changed = false;
    for (const [_agentId, agentState] of Object.entries(state)) {
      const s = agentState as AgentState;
      // Reconcile activeSessions — remove dead ones
      if (s.activeSessions && s.activeSessions.length > 0) {
        const alive = s.activeSessions.filter((sess) => sess.pid && isProcessAlive(sess.pid));
        if (alive.length !== s.activeSessions.length) {
          s.activeSessions = alive;
          if (alive.length === 0) {
            s.status = "stopped";
            s.pid = null;
          }
          changed = true;
        }
      } else if (s.pid && s.status === "running" && !isProcessAlive(s.pid)) {
        s.status = "stopped";
        s.pid = null;
        changed = true;
      }
    }
    if (changed) saveProjectState(project.id, state);
  }
}
