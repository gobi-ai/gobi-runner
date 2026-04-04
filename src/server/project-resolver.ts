import fs from "fs";
import path from "path";
import type { RunnerConfig } from "./types.js";

const RUNNER_JSON = path.join(process.cwd(), "runner.json");

export function getProjectTargetDir(projectId: string): string {
  const config: RunnerConfig = JSON.parse(fs.readFileSync(RUNNER_JSON, "utf-8"));
  const project = config.projects.find((p) => p.id === projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);
  return project.targetDir;
}

export function getRunnerDir(projectId: string): string {
  return path.join(getProjectTargetDir(projectId), ".runner");
}
