import { config } from "dotenv";
config();

import express from "express";
import cookieParser from "cookie-parser";
import fs from "fs";
import path from "path";
import type { RunnerConfig } from "./types.js";
import { loadAllAgents } from "./agent-loader.js";
import { scheduleAgent } from "./scheduler.js";
import { reconcileStates } from "./session-manager.js";
import projectsRouter from "./api/projects.js";
import agentsRouter from "./api/agents.js";
import logsRouter from "./api/logs.js";
import webhooksRouter from "./api/webhooks.js";
import domainsRouter from "./api/domains.js";
import issuesRouter from "./api/issues.js";
import { listProviders } from "./providers/index.js";

const app = express();
const PORT = 3456;

app.use(cookieParser());

// Capture raw body for webhook signature verification
app.use(express.json({
  verify: (req: any, _res, buf) => {
    req.rawBody = buf;
  },
}));

// Auth middleware — skip webhooks (they have their own signature verification)
const RUNNER_PASSWORD = process.env.RUNNER_PASSWORD;
if (RUNNER_PASSWORD) {
  app.use((req, res, next) => {
    // Webhooks and login bypass password auth
    if (req.path.startsWith("/api/webhooks/") || req.path === "/api/login") return next();

    // Check cookie, Authorization header, or ?token= query param
    const cookieToken = req.cookies?.runner_token;
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    const queryToken = req.query.token as string | undefined;

    if (cookieToken === RUNNER_PASSWORD || bearerToken === RUNNER_PASSWORD || queryToken === RUNNER_PASSWORD) {
      return next();
    }

    // Login page for browser requests
    if (req.accepts("html") && !req.path.startsWith("/api/")) {
      res.send(loginPage());
      return;
    }

    res.status(401).json({ error: "Unauthorized" });
  });
}

// API routes
app.get("/api/providers", (_req, res) => {
  res.json(listProviders().map((p) => ({
    id: p.id,
    displayName: p.displayName,
    models: p.models,
  })));
});
app.use("/api/projects", projectsRouter);
app.use("/api/projects", agentsRouter);
app.use("/api", logsRouter);
app.use("/api/webhooks", webhooksRouter);
app.use("/api/projects", domainsRouter);
app.use("/api/projects", issuesRouter);

// Login endpoint
app.post("/api/login", (req, res) => {
  const { password } = req.body ?? {};
  if (!RUNNER_PASSWORD || password === RUNNER_PASSWORD) {
    res.cookie("runner_token", RUNNER_PASSWORD, {
      httpOnly: true,
      sameSite: "strict",
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: "Wrong password" });
  }
});

// Serve static frontend in production
const clientDist = path.join(process.cwd(), "dist", "client");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

// Startup: reconcile states + schedule enabled agents
function startup() {
  const runnerPath = path.join(process.cwd(), "runner.json");
  if (!fs.existsSync(runnerPath)) {
    fs.writeFileSync(runnerPath, JSON.stringify({ projects: [] }, null, 2));
  }

  const config: RunnerConfig = JSON.parse(fs.readFileSync(runnerPath, "utf-8"));

  // Reconcile stale sessions (checks Docker containers)
  reconcileStates(config.projects);

  // Re-reconcile periodically (every 30s) to catch containers that died
  setInterval(() => {
    try { reconcileStates(config.projects); } catch {}
  }, 30_000);

  for (const project of config.projects) {
    const agents = loadAllAgents(project.id);
    for (const agent of agents) {
      if (agent.enabled) {
        scheduleAgent(project, agent);
      }
    }
  }
}

startup();

app.listen(PORT, () => {
  console.log(`Agent Runner listening on http://localhost:${PORT}`);
  if (RUNNER_PASSWORD) {
    console.log("Password protection enabled");
  } else {
    console.log("WARNING: No RUNNER_PASSWORD set — site is unprotected");
  }
});

function loginPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Agent Runner — Login</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: "Aeonik", -apple-system, BlinkMacSystemFont, sans-serif; background: #191919; color: #F0EFED; display: flex; align-items: center; justify-content: center; height: 100vh; }
    .card { background: #202020; border: 1px solid #2A2A2A; border-radius: 12px; padding: 32px; width: 340px; }
    h1 { font-size: 18px; font-weight: 600; margin-bottom: 20px; }
    input { width: 100%; padding: 10px 12px; background: #191919; border: 1px solid #383836; border-radius: 4px; color: #F0EFED; font-size: 14px; margin-bottom: 12px; font-family: inherit; }
    input:focus { outline: none; border-color: #0A85D1; }
    button { width: 100%; padding: 10px; background: #00AC47; color: #fff; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; font-family: inherit; font-weight: 500; }
    button:hover { opacity: 0.9; }
    .error { color: #EA4E43; font-size: 13px; margin-bottom: 8px; display: none; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Agent Runner</h1>
    <div class="error" id="err">Wrong password</div>
    <form id="form">
      <input type="password" name="password" placeholder="Password" autofocus />
      <button type="submit">Log in</button>
    </form>
  </div>
  <script>
    document.getElementById("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const password = e.target.password.value;
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        window.location.reload();
      } else {
        document.getElementById("err").style.display = "block";
      }
    });
  </script>
</body>
</html>`;
}
