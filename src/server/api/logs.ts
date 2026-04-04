import { Router, type Request, type Response } from "express";
import fs from "fs";
import path from "path";
import type { LogEntry } from "../types.js";
import { getRunnerDir } from "../project-resolver.js";

const router = Router();

// SSE clients indexed by "projectId:agentId"
const sseClients = new Map<string, Set<Response>>();

function logKey(projectId: string, agentId: string): string {
  return `${projectId}:${agentId}`;
}

// Active session ID per agent — set when a session starts, used for log file routing
const activeSessionIds = new Map<string, string>();

export function setActiveSession(projectId: string, agentId: string, sessionId: string): void {
  activeSessionIds.set(logKey(projectId, agentId), sessionId);
}

export function clearActiveSession(projectId: string, agentId: string): void {
  activeSessionIds.delete(logKey(projectId, agentId));
}

function logsDir(projectId: string): string {
  const dir = path.join(getRunnerDir(projectId), "logs");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function sessionLogPath(projectId: string, agentId: string, sessionId: string): string {
  return path.join(logsDir(projectId), `${agentId}_${sessionId}.log`);
}

function activeLogPath(projectId: string, agentId: string): string | null {
  const key = logKey(projectId, agentId);
  const sessionId = activeSessionIds.get(key);
  if (!sessionId) return null;
  return sessionLogPath(projectId, agentId, sessionId);
}

/** List session log files for an agent, newest first */
function listSessionLogs(projectId: string, agentId: string): string[] {
  const dir = logsDir(projectId);
  const prefix = `${agentId}_`;
  try {
    return fs.readdirSync(dir)
      .filter((f) => f.startsWith(prefix) && f.endsWith(".log"))
      .map((f) => path.join(dir, f))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  } catch {
    return [];
  }
}

export function appendLog(
  projectId: string,
  agentId: string,
  type: LogEntry["type"],
  message: string
): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    agentId,
    projectId,
    type,
    message,
  };
  const fp = activeLogPath(projectId, agentId);
  if (fp) {
    fs.appendFileSync(fp, JSON.stringify(entry) + "\n");
  }
}

export function emitLogEvent(
  projectId: string,
  agentId: string,
  entry: LogEntry
): void {
  const key = logKey(projectId, agentId);
  const clients = sseClients.get(key);
  if (clients) {
    const data = JSON.stringify(entry);
    for (const res of clients) {
      res.write(`data: ${data}\n\n`);
    }
  }
}

// GET /api/projects/:pid/agents/:aid/logs — list log entries for the current/latest session
// ?session=<id> to read a specific session, otherwise reads active or most recent
router.get("/projects/:pid/agents/:aid/logs", (req: Request, res: Response) => {
  const { pid, aid } = req.params;
  const tail = req.query.tail ? parseInt(req.query.tail as string, 10) : 200;
  const sessionParam = req.query.session as string | undefined;

  let fp: string | null = null;
  if (sessionParam) {
    fp = sessionLogPath(pid, aid, sessionParam);
  } else {
    fp = activeLogPath(pid, aid);
    if (!fp) {
      // No active session — use the most recent log file
      const files = listSessionLogs(pid, aid);
      fp = files[0] ?? null;
    }
  }

  if (!fp || !fs.existsSync(fp)) {
    res.json([]);
    return;
  }
  const lines = fs.readFileSync(fp, "utf-8").trim().split("\n").filter(Boolean);
  const entries = lines.slice(-tail).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
  res.json(entries);
});

// GET /api/logs/stream?projectId=X&agentId=Y — SSE live stream
router.get("/logs/stream", (req: Request, res: Response) => {
  const { projectId, agentId } = req.query;
  if (!projectId || !agentId) {
    res.status(400).json({ error: "projectId and agentId required" });
    return;
  }

  const key = logKey(projectId as string, agentId as string);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  res.write(`data: ${JSON.stringify({ type: "system", message: "Connected to log stream" })}\n\n`);

  if (!sseClients.has(key)) {
    sseClients.set(key, new Set());
  }
  sseClients.get(key)!.add(res);

  req.on("close", () => {
    sseClients.get(key)?.delete(res);
    if (sseClients.get(key)?.size === 0) {
      sseClients.delete(key);
    }
  });
});

export default router;
