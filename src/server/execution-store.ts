import fs from "fs";
import path from "path";
import type { ExecutionRecord } from "./types.js";
import { getRunnerDir } from "./project-resolver.js";

const MAX_RECORDS = 200;

function filePath(projectId: string): string {
  return path.join(getRunnerDir(projectId), "executions.json");
}

export function loadExecutions(projectId: string): ExecutionRecord[] {
  const fp = filePath(projectId);
  if (!fs.existsSync(fp)) return [];
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8"));
  } catch {
    return [];
  }
}

export function appendExecution(projectId: string, record: ExecutionRecord): void {
  const records = loadExecutions(projectId);
  records.unshift(record); // newest first
  if (records.length > MAX_RECORDS) records.length = MAX_RECORDS;
  const fp = filePath(projectId);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(records, null, 2));
}
