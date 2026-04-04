import { Router, type Request, type Response } from "express";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { spawn, type ChildProcess } from "child_process";
import type { RunnerConfig, Project } from "../types.js";
import { appendLog, emitLogEvent, setActiveSession, clearActiveSession } from "./logs.js";

const router = Router();
const RUNNER_JSON = path.join(process.cwd(), "runner.json");

// Track issue chat sessions: key = "projectId:issueId"
interface IssueChatSession {
  sessionId: string;
  pid: number | null;           // container PID
  child: ChildProcess | null;   // container process
  containerName?: string;
  log?: (type: "info" | "error" | "output" | "system", message: string) => void;
  isFirstMessage?: boolean;
  issueData?: any;
  busy?: boolean;
}
const issueSessions = new Map<string, IssueChatSession>();

// --- Issue cache + SSE ---
let issueCache: any[] | null = null;
let issueCacheTime = 0;
const ISSUE_QUERY = `
  query {
    issues(
      filter: {
        state: { type: { nin: ["completed", "cancelled"] }, name: { neq: "HumanReview" } }
      }
      orderBy: updatedAt
      first: 50
    ) {
      nodes {
        id
        identifier
        title
        description
        url
        priority
        priorityLabel
        state { id name type }
        team { key name states { nodes { id name type } } }
        assignee { name email avatarUrl }
        labels { nodes { name color } }
        updatedAt
        createdAt
      }
    }
  }
`;

// SSE clients waiting for issue list updates
const issueClients = new Set<Response>();

function emitIssuesToClients() {
  const data = JSON.stringify({ type: "issues_updated" });
  for (const client of issueClients) {
    client.write(`data: ${data}\n\n`);
  }
}

async function linearGql(query: string, variables: Record<string, unknown> = {}): Promise<any> {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) throw new Error("LINEAR_API_KEY not set");
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { Authorization: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (data.errors) throw new Error(data.errors[0].message);
  return data.data;
}

async function refreshIssueCache(): Promise<any[]> {
  const data = await linearGql(ISSUE_QUERY);
  issueCache = data.issues.nodes;
  issueCacheTime = Date.now();
  return issueCache!;
}

/** Called by the webhook handler when a Linear issue changes */
export async function onLinearWebhook(): Promise<void> {
  try {
    await refreshIssueCache();
    emitIssuesToClients();
    console.log("Issue cache refreshed via webhook");
  } catch (err: any) {
    console.error("Failed to refresh issue cache:", err.message);
  }
}

function getProject(projectId: string): Project | undefined {
  const config: RunnerConfig = JSON.parse(fs.readFileSync(RUNNER_JSON, "utf-8"));
  return config.projects.find((p) => p.id === projectId);
}

// GET /api/projects/:pid/issues — return cached issues, fetch if stale
router.get("/:pid/issues", async (req: Request, res: Response) => {
  const project = getProject(req.params.pid);
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  try {
    // Use cache if fresh (< 60s), otherwise refetch
    const stale = !issueCache || (Date.now() - issueCacheTime > 60_000);
    const issues = stale ? await refreshIssueCache() : issueCache!;

    const result = issues.map((issue: any) => ({
      ...issue,
      session: getIssueSession(req.params.pid, issue.identifier),
    }));

    res.json(result);
  } catch (err: any) {
    console.error("Linear API error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/projects/:pid/issues/stream — SSE for issue list updates
router.get("/:pid/issues/stream", (req: Request, res: Response) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
  issueClients.add(res);
  req.on("close", () => issueClients.delete(res));
});

// GET /api/projects/:pid/issues/sessions — list active issue chat sessions
router.get("/:pid/issues/sessions", (req: Request, res: Response) => {
  const projectId = req.params.pid;
  const sessions: { identifier: string; agentId: string; sessionId: string; busy: boolean }[] = [];
  for (const [key, session] of issueSessions.entries()) {
    if (!key.startsWith(`${projectId}:`)) continue;
    const identifier = key.slice(projectId.length + 1);
    sessions.push({
      identifier,
      agentId: `issue-${identifier.toLowerCase()}`,
      sessionId: session.sessionId,
      busy: !!session.busy,
    });
  }
  res.json(sessions);
});

function getIssueSession(projectId: string, identifier: string): { running: boolean; sessionId: string | null } {
  const key = `${projectId}:${identifier}`;
  const session = issueSessions.get(key);
  if (!session) return { running: false, sessionId: null };
  // Session exists = container is alive
  return { running: true, sessionId: session.sessionId };
}

function buildDockerArgs(project: Project, identifier: string, sessionId: string, containerName: string, entrypoint?: string): string[] {
  const image = project.dockerImage ?? "gobi-runner:latest";
  const home = process.env.HOME ?? "/root";
  return [
    "run", "--rm",
    "--entrypoint", entrypoint ?? "bash",
    "--name", containerName,
    "-e", `LINEAR_API_KEY=${process.env.LINEAR_API_KEY ?? ""}`,
    "-e", `GITHUB_ORG=${process.env.GITHUB_ORG ?? "gobi-ai"}`,
    "-e", `ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY ?? ""}`,
    "-v", `${project.targetDir}:/source:ro`,
    "-v", `${project.targetDir}/.runner/agents:/agents:ro`,
    "-v", `${home}/.gitconfig:/home/agent/.gitconfig:ro`,
    "-v", `${home}/.git-credentials:/home/agent/.git-credentials:ro`,
    "-v", `${home}/.ssh:/home/agent/.ssh:ro`,
    "-v", `${home}/.config/gh:/home/agent/.config/gh:ro`,
    "-v", `${home}/.claude:/home/agent/.claude`,
    "-v", `${home}/.claude.json:/home/agent/.claude.json`,
    // Mount MCP config into the working directory (Claude Code reads .mcp.json from cwd)
    "-v", `${path.resolve("claude-settings.json")}:/monorepo/.mcp.json:ro`,
    // Sentry MCP auth state
    ...(fs.existsSync(`${home}/.sentry`) ? ["-v", `${home}/.sentry:/home/agent/.sentry:ro`] : []),
    image,
  ];
}

function buildSetupScript(identifier: string): string {
  const branch = identifier.toLowerCase();
  return [
    `for repo_dir in /monorepo/gobi-*/; do repo=$(basename "$repo_dir"); b=$(git -C "$repo_dir" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "develop"); git -C "$repo_dir" fetch origin --quiet 2>/dev/null && git -C "$repo_dir" reset --hard "origin/$b" --quiet 2>/dev/null; done`,
    `cp -f /source/CLAUDE.md /monorepo/CLAUDE.md 2>/dev/null || true`,
    `cp -f /source/LINEAR.md /monorepo/LINEAR.md 2>/dev/null || true`,
    `cp -rf /source/approvers /monorepo/approvers 2>/dev/null || true`,
    `cp -rf /source/actors /monorepo/actors 2>/dev/null || true`,
    `cp -rf /source/.runner/domains /monorepo/.runner/domains 2>/dev/null || true`,
    `for repo_dir in /monorepo/gobi-*/; do`,
    `  cd "$repo_dir"`,
    `  if git ls-remote --exit-code --heads origin '${branch}' >/dev/null 2>&1; then`,
    `    git checkout '${branch}' 2>/dev/null || git checkout -b '${branch}' 'origin/${branch}' 2>/dev/null`,
    `    git pull origin '${branch}' --quiet 2>/dev/null`,
    `  elif git show-ref --verify --quiet "refs/heads/${branch}" 2>/dev/null; then`,
    `    git checkout '${branch}' 2>/dev/null`,
    `  else`,
    `    git checkout develop 2>/dev/null || git checkout main 2>/dev/null || true`,
    `  fi`,
    `  cd /monorepo`,
    `done`,
  ].join("\n");
}

/** Start a detached Docker container and run setup. Returns when ready. */
function spawnIssueContainer(
  project: Project,
  identifier: string,
  session: IssueChatSession,
): Promise<void> {
  const agentId = `issue-${identifier.toLowerCase()}`;
  const containerName = `issue-${identifier.toLowerCase()}-${session.sessionId.slice(0, 8)}`;

  setActiveSession(project.id, agentId, session.sessionId);

  const log = (type: "info" | "error" | "output" | "system", message: string) => {
    appendLog(project.id, agentId, type, message);
    emitLogEvent(project.id, agentId, {
      type, message,
      timestamp: new Date().toISOString(),
      agentId,
      projectId: project.id,
    });
  };

  session.log = log;
  session.containerName = containerName;

  return new Promise((resolve, reject) => {
    const dockerArgs = buildDockerArgs(project, identifier, session.sessionId, containerName);
    const runArgs = [
      ...dockerArgs.slice(0, -1),
      "-d",
      dockerArgs[dockerArgs.length - 1],
      "-c", `sleep 86400`,
    ];

    const runChild = spawn("docker", runArgs, {
      cwd: project.targetDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    let containerId = "";
    runChild.stdout?.on("data", (d: Buffer) => { containerId += d.toString().trim(); });
    runChild.stderr?.on("data", (d: Buffer) => {
      const t = d.toString().trim();
      if (t) log("error", t);
    });

    runChild.on("close", (code) => {
      if (code !== 0 || !containerId) {
        reject(new Error("Container failed to start"));
        return;
      }

      const key = `${project.id}:${identifier}`;
      // Store a dummy child to mark session as alive (for getIssueSession)
      session.pid = -1;
      issueSessions.set(key, session);

      // Run setup
      const setupChild = spawn("docker", ["exec", containerName, "bash", "-c", buildSetupScript(identifier)], {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
      });

      setupChild.on("close", () => {
        log("system", "Ready");
        resolve();
      });
    });
  });
}

/** Run claude --print inside the container via docker exec. Returns promise when done. */
function execClaude(
  session: IssueChatSession,
  prompt: string,
  isResume: boolean,
  model?: string,
): Promise<void> {
  return new Promise((resolve) => {
    const escaped = prompt.replace(/'/g, "'\\''");
    const modelFlag = model ? `--model '${model}'` : "";
    const log = session.log!;

    const claudeCmd = isResume
      ? `cd /monorepo && claude -p '${escaped}' --print --verbose --output-format stream-json --resume '${session.sessionId}' --permission-mode bypassPermissions ${modelFlag}`
      : `cd /monorepo && claude -p '${escaped}' --print --verbose --output-format stream-json --session-id '${session.sessionId}' --permission-mode bypassPermissions ${modelFlag}`;

    const child = spawn("docker", ["exec", session.containerName!, "bash", "-c", claudeCmd], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    session.child = child;
    session.pid = child.pid!;
    session.busy = true;

    child.stdout?.on("data", (data: Buffer) => {
      for (const line of data.toString().split("\n").filter(Boolean)) {
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
            log("info", `Cost: $${Number(parsed.cost_usd ?? 0).toFixed(6)}`);
          }
        } catch {
          log("output", line);
        }
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      const text = data.toString().trim();
      if (text) log("error", text);
    });

    child.on("close", (code) => {
      session.child = null;
      session.busy = false;
      if (code !== 0) {
        log("system", `Claude exited with code ${code}`);
      }
      resolve();
    });
  });
}

// POST /api/projects/:pid/issues/:identifier/chat — start a chat session
router.post("/:pid/issues/:identifier/chat", async (req: Request, res: Response) => {
  const project = getProject(req.params.pid);
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const identifier = req.params.identifier;
  const key = `${project.id}:${identifier}`;
  const issue = req.body.issue;
  if (!issue) { res.status(400).json({ error: "issue data required" }); return; }

  const agentId = `issue-${identifier.toLowerCase()}`;

  // Return existing session if one is alive
  const existing = issueSessions.get(key);
  if (existing?.child) {
    res.json({ ok: true, sessionId: existing.sessionId, agentId });
    return;
  }

  const sessionId = uuidv4();
  const session: IssueChatSession = { sessionId, pid: null, child: null, isFirstMessage: true };
  issueSessions.set(key, session);

  const log = (type: "system", message: string) => {
    appendLog(project.id, agentId, type, message);
    emitLogEvent(project.id, agentId, { type, message, timestamp: new Date().toISOString(), agentId, projectId: project.id });
  };

  log("system", `Spawning session for ${identifier}: ${issue.title}`);

  try {
    // Force-remove any leftover container
    spawn("docker", ["rm", "-f", `issue-${identifier.toLowerCase()}-${sessionId.slice(0, 8)}`], { stdio: "ignore" });
    await new Promise((r) => setTimeout(r, 500));

    // Start container and run setup
    await spawnIssueContainer(project, identifier, session);

    session.issueData = issue;
    res.json({ ok: true, sessionId, agentId });
  } catch (err: any) {
    issueSessions.delete(key);
    log("system", `Failed to start: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects/:pid/issues/:identifier/message — send a message via stdin
router.post("/:pid/issues/:identifier/message", async (req: Request, res: Response) => {
  const project = getProject(req.params.pid);
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const identifier = req.params.identifier;
  const key = `${project.id}:${identifier}`;
  const session = issueSessions.get(key);
  if (!session) { res.status(404).json({ error: "No running session. Click Chat first." }); return; }

  if (session.busy) {
    res.status(409).json({ error: "Claude is still responding. Wait for it to finish." });
    return;
  }

  const { message } = req.body;
  if (!message) { res.status(400).json({ error: "message is required" }); return; }

  session.log?.("system", `You: ${message}`);

  // On first message, prepend issue context
  const isFirst = session.isFirstMessage !== false;
  const prompt = isFirst && session.issueData
    ? `${buildIssuePrompt(session.issueData)}\n\n## User Message\n\n${message}`
    : message;

  // Run claude --print (or --resume) inside the container
  execClaude(session, prompt, !isFirst, req.body.model);
  session.isFirstMessage = false;

  res.json({ ok: true });
});

// POST /api/projects/:pid/issues/:identifier/stop — stop issue session
/** Stop an issue chat session. Exported for use by webhook handler. */
export function stopIssueChatSession(projectId: string, identifier: string): boolean {
  const key = `${projectId}:${identifier}`;
  const session = issueSessions.get(key);
  if (!session) return false;
  // Kill the container (which kills Claude inside it)
  if (session.child) {
    session.child.kill("SIGTERM");
    session.pid = null;
    session.child = null;
  }
  // Also force-remove the docker container by name
  if (session.containerName) {
    spawn("docker", ["rm", "-f", session.containerName], { stdio: "ignore" });
  }
  const agentId = `issue-${identifier.toLowerCase()}`;
  clearActiveSession(projectId, agentId);
  issueSessions.delete(key);
  return true;
}

router.post("/:pid/issues/:identifier/stop", (req: Request, res: Response) => {
  const stopped = stopIssueChatSession(req.params.pid, req.params.identifier);
  res.json({ ok: true, stopped });
});

// PUT /api/projects/:pid/issues/:identifier/status — change issue status in Linear
router.put("/:pid/issues/:identifier/status", async (req: Request, res: Response) => {
  const { stateId } = req.body;
  if (!stateId) { res.status(400).json({ error: "stateId is required" }); return; }

  const project = getProject(req.params.pid);
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  // Find the issue ID from the cache
  const issue = issueCache?.find((i: any) => i.identifier === req.params.identifier);
  if (!issue) { res.status(404).json({ error: "Issue not found in cache" }); return; }

  try {
    const data = await linearGql(`
      mutation($id: String!, $stateId: String!) {
        issueUpdate(id: $id, input: { stateId: $stateId }) {
          success
          issue { identifier state { id name type } }
        }
      }
    `, { id: issue.id, stateId });

    const success = data.issueUpdate?.success;
    if (success) {
      // Refresh cache
      await refreshIssueCache();
      emitIssuesToClients();
    }
    res.json({ ok: success, issue: data.issueUpdate?.issue });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

function buildIssuePrompt(issue: any): string {
  const lines: string[] = [
    `You are working on Linear issue ${issue.identifier}: ${issue.title}`,
    ``,
    `**Status:** ${issue.state?.name}`,
    `**Team:** ${issue.team?.key} (${issue.team?.name})`,
  ];
  if (issue.assignee) lines.push(`**Assignee:** ${issue.assignee.name}`);
  if (issue.labels?.nodes?.length) {
    lines.push(`**Labels:** ${issue.labels.nodes.map((l: any) => l.name).join(", ")}`);
  }
  if (issue.url) lines.push(`**URL:** ${issue.url}`);
  if (issue.description) {
    lines.push(``, `## Description`, ``, issue.description);
  }
  lines.push(
    ``,
    `## Instructions`,
    ``,
    `If an issue branch exists, you are already on it. Otherwise you are on develop — create a branch named \`${issue.identifier.toLowerCase()}\` before making changes.`,
    ``,
    `1. Implement the changes described in the issue`,
    `2. Commit your changes with a message referencing ${issue.identifier}`,
    `3. Create a Pull Request with the Linear issue link in the body`,
    `4. Update the Linear issue status when done`,
  );
  return lines.join("\n");
}



function formatToolInput(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "Read": return input.file_path ? String(input.file_path) : "";
    case "Write": return input.file_path ? String(input.file_path) : "";
    case "Edit": return input.file_path ? String(input.file_path) : "";
    case "Glob": return input.pattern ? String(input.pattern) : "";
    case "Grep": return [input.pattern, input.path].filter(Boolean).join(" in ") || "";
    case "Bash": return input.command ? String(input.command).slice(0, 120) : "";
    case "Agent": return input.description ? String(input.description) : "";
    default: {
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

export default router;
