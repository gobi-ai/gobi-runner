import { Router, type Request, type Response } from "express";
import fs from "fs";
import path from "path";
import type { RunnerConfig, Project } from "../types.js";

const router = Router();
const RUNNER_JSON = path.join(process.cwd(), "runner.json");

function loadConfig(): RunnerConfig {
  if (!fs.existsSync(RUNNER_JSON)) return { projects: [] };
  return JSON.parse(fs.readFileSync(RUNNER_JSON, "utf-8"));
}

function saveConfig(config: RunnerConfig): void {
  fs.writeFileSync(RUNNER_JSON, JSON.stringify(config, null, 2));
}

// GET /api/projects
router.get("/", (_req: Request, res: Response) => {
  const config = loadConfig();
  res.json(config.projects);
});

// POST /api/projects
router.post("/", (req: Request, res: Response) => {
  const { id, name, targetDir } = req.body as Project;
  if (!id || !name || !targetDir) {
    res.status(400).json({ error: "id, name, and targetDir are required" });
    return;
  }
  const config = loadConfig();
  if (config.projects.find((p) => p.id === id)) {
    res.status(409).json({ error: "Project already exists" });
    return;
  }
  config.projects.push({ id, name, targetDir });
  saveConfig(config);

  // Create .runner directory in the project's target dir
  const runnerAgentsDir = path.join(targetDir, ".runner", "agents");
  fs.mkdirSync(runnerAgentsDir, { recursive: true });

  res.status(201).json({ id, name, targetDir });
});

// DELETE /api/projects/:id
router.delete("/:id", (req: Request, res: Response) => {
  const config = loadConfig();
  const idx = config.projects.findIndex((p) => p.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  config.projects.splice(idx, 1);
  saveConfig(config);
  res.json({ ok: true });
});

export default router;
