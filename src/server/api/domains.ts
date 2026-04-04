import { Router, type Request, type Response } from "express";
import fs from "fs";
import path from "path";
import type { RunnerConfig } from "../types.js";
import { getRunnerDir } from "../project-resolver.js";

const router = Router();
const RUNNER_JSON = path.join(process.cwd(), "runner.json");

function getProject(projectId: string) {
  const config: RunnerConfig = JSON.parse(fs.readFileSync(RUNNER_JSON, "utf-8"));
  return config.projects.find((p) => p.id === projectId);
}

function getDomainsDir(projectId: string): string {
  return path.join(getRunnerDir(projectId), "domains");
}

export interface Domain {
  id: string;       // filename without .md
  content: string;  // full markdown content
}

// GET /api/projects/:pid/domains
router.get("/:pid/domains", (req: Request, res: Response) => {
  const project = getProject(req.params.pid);
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const dir = getDomainsDir(project.id);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    res.json([]);
    return;
  }

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
  const domains: Domain[] = files.map((f) => ({
    id: f.replace(/\.md$/, ""),
    content: fs.readFileSync(path.join(dir, f), "utf-8"),
  }));
  res.json(domains);
});

// GET /api/projects/:pid/domains/:did
router.get("/:pid/domains/:did", (req: Request, res: Response) => {
  const project = getProject(req.params.pid);
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const filePath = path.join(getDomainsDir(project.id), `${req.params.did}.md`);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: "Domain not found" }); return; }

  res.json({
    id: req.params.did,
    content: fs.readFileSync(filePath, "utf-8"),
  });
});

// POST /api/projects/:pid/domains
router.post("/:pid/domains", (req: Request, res: Response) => {
  const project = getProject(req.params.pid);
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const { id, content } = req.body;
  if (!id) { res.status(400).json({ error: "id is required" }); return; }

  const dir = getDomainsDir(project.id);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${id}.md`);

  if (fs.existsSync(filePath)) {
    res.status(409).json({ error: "Domain already exists" });
    return;
  }

  fs.writeFileSync(filePath, content || `# ${id}\n\n## Scope\n\n## Regression Checklist\n\n## Risk Areas\n\n## Files to Inspect\n`);
  res.status(201).json({ id, content: fs.readFileSync(filePath, "utf-8") });
});

// PUT /api/projects/:pid/domains/:did
router.put("/:pid/domains/:did", (req: Request, res: Response) => {
  const project = getProject(req.params.pid);
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const filePath = path.join(getDomainsDir(project.id), `${req.params.did}.md`);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: "Domain not found" }); return; }

  const { content } = req.body;
  if (typeof content !== "string") { res.status(400).json({ error: "content is required" }); return; }

  fs.writeFileSync(filePath, content);
  res.json({ id: req.params.did, content });
});

// DELETE /api/projects/:pid/domains/:did
router.delete("/:pid/domains/:did", (req: Request, res: Response) => {
  const project = getProject(req.params.pid);
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const filePath = path.join(getDomainsDir(project.id), `${req.params.did}.md`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  res.json({ ok: true });
});

export default router;
