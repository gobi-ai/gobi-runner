import type { Project, AgentConfig } from "./types.js";
import { executeAgent } from "./session-manager.js";

/**
 * Per-issue execution queue with overwriting semantics.
 *
 * Only one agent runs per issue at a time. If a new trigger arrives while
 * an agent is running for the same issue, it overwrites any pending entry.
 * When the running agent finishes, the pending entry (if any) starts.
 *
 * This prevents race conditions where duplicate or rapid-fire webhooks
 * cause multiple agents to run concurrently on the same issue.
 */

interface QueueEntry {
  project: Project;
  agent: AgentConfig;
}

// issueId → currently running
const running = new Map<string, QueueEntry>();
// issueId → next to run (only the latest; previous pending is overwritten)
const pending = new Map<string, QueueEntry>();

/**
 * Enqueue an agent execution for an issue.
 * - If nothing is running for this issue: starts immediately.
 * - If something is running: overwrites any pending entry.
 * Returns { started: true } or { queued: true, replaced: string | null }.
 */
export function enqueueForIssue(
  issueId: string,
  project: Project,
  agent: AgentConfig
): { started: boolean; queued: boolean; replaced: string | null } {
  if (running.has(issueId)) {
    const prev = pending.get(issueId);
    pending.set(issueId, { project, agent });
    console.log(
      `[issue-queue] ${issueId}: queued ${agent.id}` +
      (prev ? ` (replaced pending ${prev.agent.id})` : "")
    );
    return { started: false, queued: true, replaced: prev?.agent.id ?? null };
  }

  // Start immediately
  running.set(issueId, { project, agent });
  console.log(`[issue-queue] ${issueId}: starting ${agent.id}`);
  executeAgent(project, agent);
  return { started: true, queued: false, replaced: null };
}

/**
 * Called by session-manager when an agent finishes for an issue.
 * If there's a pending entry, starts it.
 */
export function onIssueAgentComplete(issueId: string): void {
  running.delete(issueId);

  const next = pending.get(issueId);
  if (next) {
    pending.delete(issueId);
    running.set(issueId, next);
    console.log(`[issue-queue] ${issueId}: starting queued ${next.agent.id}`);
    executeAgent(next.project, next.agent);
  }
}

/** Check if an agent is currently running for an issue. */
export function isIssueRunning(issueId: string): boolean {
  return running.has(issueId);
}

/** Get queue status for debugging. */
export function getQueueStatus(): { running: string[]; pending: string[] } {
  return {
    running: Array.from(running.entries()).map(([id, e]) => `${id}:${e.agent.id}`),
    pending: Array.from(pending.entries()).map(([id, e]) => `${id}:${e.agent.id}`),
  };
}
