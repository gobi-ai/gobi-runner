import fs from "fs";
import path from "path";
import matter from "gray-matter";
import type { AgentConfig, AgentFrontmatter } from "./types.js";
import { getRunnerDir } from "./project-resolver.js";

export function getAgentsDir(projectId: string): string {
  return path.join(getRunnerDir(projectId), "agents");
}

export function loadAgent(projectId: string, filename: string): AgentConfig {
  const filePath = path.join(getAgentsDir(projectId), filename);
  const raw = fs.readFileSync(filePath, "utf-8");
  const { data, content } = matter(raw);
  const frontmatter = data as AgentFrontmatter;
  const id = filename.replace(/\.md$/, "");

  return {
    id,
    name: frontmatter.name || id,
    schedule: frontmatter.schedule || "",
    enabled: frontmatter.enabled ?? false,
    permissionMode: frontmatter.permissionMode || "default",
    provider: frontmatter.provider || "claude",
    model: frontmatter.model || "",
    tools: frontmatter.tools ?? [],
    triggers: frontmatter.triggers ?? [],
    prompt: content.trim(),
    filePath,
  };
}

export function loadAllAgents(projectId: string): AgentConfig[] {
  const dir = getAgentsDir(projectId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    return [];
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  return files.map((f) => loadAgent(projectId, f));
}

export function saveAgent(
  projectId: string,
  agentId: string,
  config: AgentFrontmatter,
  prompt: string
): void {
  const dir = getAgentsDir(projectId);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${agentId}.md`);
  const content = matter.stringify(prompt, config);
  fs.writeFileSync(filePath, content);
}

export function deleteAgentFile(projectId: string, agentId: string): void {
  const filePath = path.join(getAgentsDir(projectId), `${agentId}.md`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}
