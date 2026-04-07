import crypto from "crypto";
import { Router, type Request, type Response } from "express";
import fs from "fs";
import path from "path";
import type { RunnerConfig, AgentConfig, LinearWebhookTrigger } from "../types.js";
import { loadAllAgents } from "../agent-loader.js";
import { enqueueForIssue } from "../issue-queue.js";
import { appendLog, emitLogEvent } from "./logs.js";
import { onLinearWebhook, stopIssueChatSession } from "./issues.js";
import { downloadIssueAttachments } from "../attachment-downloader.js";

const router = Router();
const RUNNER_JSON = path.join(process.cwd(), "runner.json");

// Linear webhook payload types (subset of what Linear sends)
interface LinearWebhookPayload {
  action: "create" | "update" | "remove";
  type: "Issue" | "Comment" | "Project" | string;
  data: {
    id: string;
    identifier?: string;
    title?: string;
    description?: string;
    state?: { name: string; type: string };
    team?: { key: string; name: string };
    project?: { name: string; id: string };
    labels?: { nodes: { name: string }[] };
    priority?: number;
    priorityLabel?: string;
    assignee?: { name: string; email: string };
    url?: string;
    [key: string]: unknown;
  };
  updatedFrom?: {
    state?: { name: string; type: string };
    [key: string]: unknown;
  };
  url?: string;
  createdAt?: string;
}

function verifyLinearSignature(
  body: Buffer,
  signature: string | undefined,
  secret: string
): boolean {
  if (!signature) return false;
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(body);
  const digest = hmac.digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(digest)
  );
}

function matchesTrigger(
  trigger: LinearWebhookTrigger,
  payload: LinearWebhookPayload
): boolean {
  const newState = payload.data.state?.name;

  // Must have a status change
  if (!newState) return false;

  // Check statusTo filter
  if (trigger.statusTo && trigger.statusTo.length > 0) {
    const match = trigger.statusTo.some(
      (s) => s.toLowerCase() === newState.toLowerCase()
    );
    if (!match) return false;
  }

  // Check team filter
  if (trigger.teams && trigger.teams.length > 0) {
    const teamKey = payload.data.team?.key;
    if (!teamKey || !trigger.teams.includes(teamKey)) return false;
  }

  // Check label filter
  if (trigger.labels && trigger.labels.length > 0) {
    const issueLabels =
      payload.data.labels?.nodes?.map((l) => l.name.toLowerCase()) ?? [];
    const hasLabel = trigger.labels.some((l) =>
      issueLabels.includes(l.toLowerCase())
    );
    if (!hasLabel) return false;
  }

  // Check project filter
  if (trigger.projects && trigger.projects.length > 0) {
    const projectName = payload.data.project?.name;
    if (!projectName || !trigger.projects.some(
      (p) => p.toLowerCase() === projectName.toLowerCase()
    )) return false;
  }

  return true;
}

function buildTriggerContext(payload: LinearWebhookPayload): string {
  const d = payload.data;
  const fromState = payload.updatedFrom?.state?.name;
  const toState = d.state?.name;

  const lines: string[] = [
    `## Linear Issue Trigger`,
    ``,
    `This agent was triggered by a Linear issue status change.`,
    ``,
    `- **Issue:** ${d.identifier ?? d.id} — ${d.title ?? "(no title)"}`,
    `- **Status change:** ${fromState ?? "(unknown)"} → ${toState ?? "(unknown)"}`,
  ];

  if (d.team) lines.push(`- **Team:** ${d.team.key} (${d.team.name})`);
  if (d.assignee) lines.push(`- **Assignee:** ${d.assignee.name}`);
  if (d.priorityLabel) lines.push(`- **Priority:** ${d.priorityLabel}`);
  if (d.url) lines.push(`- **URL:** ${d.url}`);
  if (d.labels?.nodes?.length) {
    lines.push(
      `- **Labels:** ${d.labels.nodes.map((l) => l.name).join(", ")}`
    );
  }
  if (d.description) {
    lines.push(``, `### Description`, ``, d.description);
  }

  return lines.join("\n");
}

// POST /api/webhooks/linear
router.post("/linear", async (req: Request, res: Response) => {
  // Verify signature if webhook secret is configured
  const secret = process.env.LINEAR_WEBHOOK_SECRET;
  if (secret) {
    const signature = req.headers["linear-signature"] as string | undefined;
    // req.body is already parsed by express.json(), but we need the raw body for verification
    // We'll re-stringify — Linear's docs say to use the raw body, so we should switch to raw body middleware
    // For now, if signature verification is desired, the raw body middleware should be added
    const rawBody = (req as any).rawBody as Buffer | undefined;
    if (rawBody && !verifyLinearSignature(rawBody, signature, secret)) {
      res.status(401).json({ error: "Invalid signature" });
      return;
    }
  }

  const payload = req.body as LinearWebhookPayload;

  console.log(`[webhook/linear] Received: type=${payload.type} action=${payload.action} issue=${payload.data.identifier ?? payload.data.id} state=${payload.data.state?.name ?? "n/a"} project=${payload.data.project?.name ?? "n/a"}`);

  // Refresh issue cache for any Issue event (create, update, remove)
  if (payload.type === "Issue") {
    onLinearWebhook();
  }

  // Trigger agents for Issue creates and updates with a state
  if (payload.type !== "Issue" || (payload.action !== "update" && payload.action !== "create")) {
    res.json({ ok: true, matched: 0, reason: "not an issue create/update" });
    return;
  }

  if (!payload.data.state) {
    res.json({ ok: true, matched: 0, reason: "no state in payload" });
    return;
  }

  // Only trigger on actual status changes, not other field updates.
  // Linear always includes data.state (current state) on Issue updates,
  // but updatedFrom.state is only present when the state field changed.
  if (payload.action === "update" && !payload.updatedFrom?.state) {
    res.json({ ok: true, matched: 0, reason: "not a status change" });
    return;
  }

  // Auto-stop issue chat sessions when issue moves to Done or Cancelled
  const newState = payload.data.state?.name?.toLowerCase();
  if (newState === "done" || newState === "cancelled") {
    const identifier = payload.data.identifier;
    if (identifier) {
      const config2: RunnerConfig = JSON.parse(fs.readFileSync(RUNNER_JSON, "utf-8"));
      for (const project of config2.projects) {
        if (stopIssueChatSession(project.id, identifier)) {
          console.log(`[webhook/linear] Auto-stopped issue chat for ${identifier} (→ ${payload.data.state?.name})`);
        }
      }
    }
  }

  // Load all projects and find agents with matching linear-webhook triggers
  const config: RunnerConfig = JSON.parse(
    fs.readFileSync(RUNNER_JSON, "utf-8")
  );

  const triggered: string[] = [];
  let triggerContext = buildTriggerContext(payload);

  // Download issue attachments (images from description + Linear attachments API)
  // We do this once and share the result across all triggered agents
  const issueDescription = payload.data.description;
  const issueLinearId = payload.data.id; // Linear internal UUID
  let attachmentsDir: string | undefined;

  for (const project of config.projects) {
    const agents = loadAllAgents(project.id);
    let projectAttachmentsDir: string | undefined;

    for (const agent of agents) {
      if (!agent.enabled) continue;
      if (!agent.triggers || agent.triggers.length === 0) continue;

      for (const trigger of agent.triggers) {
        if (trigger.type !== "linear-webhook") continue;
        if (!matchesTrigger(trigger, payload)) continue;

        // Download attachments once per project on first matching agent
        if (projectAttachmentsDir === undefined && issueDescription) {
          try {
            const result = await downloadIssueAttachments(
              project.id,
              `webhook-${payload.data.identifier ?? payload.data.id}`,
              issueDescription,
              issueLinearId
            );
            if (result) {
              projectAttachmentsDir = result.dir;
              triggerContext += `\n\n### Attachments\n\nIssue images have been downloaded to \`/tmp/attachments/\`. See \`/tmp/attachments/attachments.md\` for the full list.`;
            } else {
              projectAttachmentsDir = ""; // no attachments, don't retry
            }
          } catch (err) {
            console.error("[webhook/linear] Failed to download attachments:", err);
            projectAttachmentsDir = "";
          }
        }

        const log = (
          type: "info" | "system",
          message: string
        ) => {
          appendLog(project.id, agent.id, type, message);
          emitLogEvent(project.id, agent.id, {
            type,
            message,
            timestamp: new Date().toISOString(),
            agentId: agent.id,
            projectId: project.id,
          });
        };

        // Inject trigger context and execute (session must start before logging so the log file exists)
        const agentWithContext: AgentConfig = {
          ...agent,
          triggerContext,
          attachmentsDir: projectAttachmentsDir || undefined,
          linearIdentifier: payload.data.identifier,
        };
        const issueId = payload.data.identifier ?? payload.data.id;
        const result = enqueueForIssue(issueId, project, agentWithContext);

        if (result.started) {
          log(
            "system",
            `Linear webhook triggered: ${issueId} moved to "${payload.data.state?.name}"`
          );
        } else {
          log(
            "system",
            `Linear webhook queued: ${issueId} moved to "${payload.data.state?.name}" (agent already running${result.replaced ? `, replaced pending ${result.replaced}` : ""})`
          );
        }
        triggered.push(`${project.id}:${agent.id}`);
        break; // only trigger once per agent even if multiple triggers match
      }
    }
  }

  console.log(`[webhook/linear] Result: matched=${triggered.length} triggered=[${triggered.join(", ")}] issue=${payload.data.identifier} status=${payload.data.state?.name}`);

  res.json({
    ok: true,
    matched: triggered.length,
    triggered,
    issue: payload.data.identifier,
    status: payload.data.state?.name,
  });
});

// POST /api/webhooks/github
router.post("/github", async (req: Request, res: Response) => {
  // Verify GitHub webhook signature
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (secret) {
    const sig = req.headers["x-hub-signature-256"] as string | undefined;
    const rawBody = (req as any).rawBody as Buffer | undefined;
    if (!rawBody || !sig) {
      res.status(401).json({ error: "Missing signature" });
      return;
    }
    const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      res.status(401).json({ error: "Invalid signature" });
      return;
    }
  }

  const event = req.headers["x-github-event"];
  const payload = req.body;

  // Only care about merged PRs
  if (event !== "pull_request" || payload.action !== "closed" || !payload.pull_request?.merged) {
    res.json({ ok: true, reason: "not a merged PR" });
    return;
  }

  // Parse Linear issue identifier from PR body (e.g. https://linear.app/my-org/issue/ENG-42/...)
  const prBody: string = payload.pull_request.body || "";
  const match = prBody.match(/linear\.app\/[^/]+\/issue\/([A-Z]+-\d+)/i);
  if (!match) {
    res.json({ ok: true, reason: "no Linear issue link found in PR body" });
    return;
  }

  const identifier = match[1].toUpperCase(); // e.g. "ENG-200"
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "LINEAR_API_KEY not set" });
    return;
  }

  try {
    // Find issue ID and Done state ID
    const searchRes = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: { "Authorization": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `query($identifier: String!) {
          issueSearch(query: $identifier, first: 1) {
            nodes {
              id
              title
              team {
                states { nodes { id name type } }
              }
            }
          }
        }`,
        variables: { identifier },
      }),
    });

    const searchData = await searchRes.json() as any;
    const issue = searchData.data?.issueSearch?.nodes?.[0];
    if (!issue) {
      res.json({ ok: false, reason: `Linear issue ${identifier} not found` });
      return;
    }

    const doneState = issue.team.states.nodes.find(
      (s: any) => s.type === "completed" && s.name.toLowerCase() === "done"
    ) ?? issue.team.states.nodes.find(
      (s: any) => s.type === "completed"
    );

    if (!doneState) {
      res.json({ ok: false, reason: `No completed state found for team` });
      return;
    }

    // Transition issue to Done
    const updateRes = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: { "Authorization": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `mutation($id: String!, $stateId: String!) {
          issueUpdate(id: $id, input: { stateId: $stateId }) {
            success
            issue { identifier state { name } }
          }
        }`,
        variables: { id: issue.id, stateId: doneState.id },
      }),
    });

    const updateData = await updateRes.json() as any;
    const success = updateData.data?.issueUpdate?.success;

    console.log(`GitHub webhook: PR merged → ${identifier} → ${doneState.name} (${success ? "ok" : "failed"})`);
    res.json({ ok: success, identifier, state: doneState.name });
  } catch (err: any) {
    console.error("GitHub webhook error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
