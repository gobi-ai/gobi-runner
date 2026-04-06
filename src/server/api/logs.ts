import { Router, type Request, type Response } from "express";
import fs from "fs";
import path from "path";
import type { LogEntry } from "../types.js";
import { getRunnerDir } from "../project-resolver.js";

const router = Router();

// SSE clients indexed by "projectId:agentId:sessionId"
const sseClients = new Map<string, Set<Response>>();

function logKey(projectId: string, agentId: string): string {
  return `${projectId}:${agentId}`;
}

function sseKey(projectId: string, agentId: string, sessionId: string): string {
  return `${projectId}:${agentId}:${sessionId}`;
}

// Active session IDs per agent — supports multiple concurrent sessions
const activeSessionIds = new Map<string, Set<string>>();

export function setActiveSession(projectId: string, agentId: string, sessionId: string): void {
  const key = logKey(projectId, agentId);
  if (!activeSessionIds.has(key)) {
    activeSessionIds.set(key, new Set());
  }
  activeSessionIds.get(key)!.add(sessionId);
}

export function clearActiveSession(projectId: string, agentId: string, sessionId: string): void {
  const key = logKey(projectId, agentId);
  const sessions = activeSessionIds.get(key);
  if (sessions) {
    sessions.delete(sessionId);
    if (sessions.size === 0) {
      activeSessionIds.delete(key);
    }
  }
}

/** Get all active session IDs for an agent */
export function getActiveSessions(projectId: string, agentId: string): string[] {
  const key = logKey(projectId, agentId);
  const sessions = activeSessionIds.get(key);
  return sessions ? [...sessions] : [];
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
  const sessions = activeSessionIds.get(key);
  if (!sessions || sessions.size === 0) return null;
  // Return the most recently added session's log
  const sessionId = [...sessions].pop()!;
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
  sessionIdOrType: string,
  typeOrMessage: LogEntry["type"] | string,
  messageOrUndef?: string
): void {
  // Support both (projectId, agentId, sessionId, type, message) and (projectId, agentId, type, message)
  let sessionId: string | undefined;
  let type: LogEntry["type"];
  let message: string;
  if (messageOrUndef !== undefined) {
    sessionId = sessionIdOrType;
    type = typeOrMessage as LogEntry["type"];
    message = messageOrUndef;
  } else {
    type = sessionIdOrType as LogEntry["type"];
    message = typeOrMessage;
    // Use latest active session
    const sessions = getActiveSessions(projectId, agentId);
    sessionId = sessions.length > 0 ? sessions[sessions.length - 1] : undefined;
  }
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    agentId,
    projectId,
    type,
    message,
    sessionId,
  };
  if (sessionId) {
    const fp = sessionLogPath(projectId, agentId, sessionId);
    fs.appendFileSync(fp, JSON.stringify(entry) + "\n");
  }
}

export function emitLogEvent(
  projectId: string,
  agentId: string,
  sessionIdOrEntry: string | LogEntry,
  entryOrUndef?: LogEntry
): void {
  let sessionId: string | undefined;
  let entry: LogEntry;
  if (entryOrUndef !== undefined) {
    sessionId = sessionIdOrEntry as string;
    entry = entryOrUndef;
  } else {
    entry = sessionIdOrEntry as LogEntry;
    sessionId = entry.sessionId;
    if (!sessionId) {
      const sessions = getActiveSessions(projectId, agentId);
      sessionId = sessions.length > 0 ? sessions[sessions.length - 1] : undefined;
    }
  }
  // Emit to session-specific SSE clients
  if (sessionId) {
    const sk = sseKey(projectId, agentId, sessionId);
    const sessionClients = sseClients.get(sk);
    if (sessionClients) {
      const data = JSON.stringify(entry);
      for (const res of sessionClients) {
        res.write(`data: ${data}\n\n`);
      }
    }
  }

  // Also emit to agent-level SSE clients (legacy / overview)
  const ak = logKey(projectId, agentId);
  const agentClients = sseClients.get(ak);
  if (agentClients) {
    const data = JSON.stringify(entry);
    for (const res of agentClients) {
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

// GET /api/logs/stream?projectId=X&agentId=Y[&sessionId=Z] — SSE live stream
// If sessionId is provided, only receive events for that session
router.get("/logs/stream", (req: Request, res: Response) => {
  const { projectId, agentId, sessionId } = req.query;
  if (!projectId || !agentId) {
    res.status(400).json({ error: "projectId and agentId required" });
    return;
  }

  // Use session-specific key if sessionId provided, otherwise agent-level key
  const key = sessionId
    ? sseKey(projectId as string, agentId as string, sessionId as string)
    : logKey(projectId as string, agentId as string);

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
