import cron from "node-cron";
import type { AgentConfig, CronTrigger, Project } from "./types.js";
import { executeAgent } from "./session-manager.js";
import { appendLog, emitLogEvent } from "./api/logs.js";

const scheduledTasks = new Map<string, cron.ScheduledTask[]>();

function taskKey(projectId: string, agentId: string): string {
  return `${projectId}:${agentId}`;
}

function getCronSchedules(agent: AgentConfig): string[] {
  const schedules: string[] = [];
  // Collect cron triggers from triggers array
  for (const trigger of agent.triggers ?? []) {
    if (trigger.type === "cron") {
      schedules.push(trigger.schedule);
    }
  }
  // Backward compat: use legacy schedule field if no cron triggers defined
  if (schedules.length === 0 && agent.schedule) {
    schedules.push(agent.schedule);
  }
  return schedules;
}

export function scheduleAgent(project: Project, agent: AgentConfig): void {
  // Unschedule existing if any
  unscheduleAgent(project.id, agent.id);

  if (!agent.enabled) return;

  const key = taskKey(project.id, agent.id);
  const schedules = getCronSchedules(agent);
  const tasks: cron.ScheduledTask[] = [];

  for (const schedule of schedules) {
    if (!cron.validate(schedule)) {
      console.error(`Invalid cron schedule for ${agent.id}: ${schedule}`);
      continue;
    }

    const task = cron.schedule(schedule, () => {
      const log = (type: "info" | "system", message: string) => {
        appendLog(project.id, agent.id, type, message);
        emitLogEvent(project.id, agent.id, {
          type,
          message,
          timestamp: new Date().toISOString(),
          agentId: agent.id,
          projectId: project.id,
        });
      };
      executeAgent(project, agent);
      log("system", `Cron triggered: ${schedule}`);
    });

    tasks.push(task);
    console.log(`Scheduled ${agent.id} with cron: ${schedule}`);
  }

  if (tasks.length > 0) {
    scheduledTasks.set(key, tasks);
  }
}

export function unscheduleAgent(projectId: string, agentId: string): void {
  const key = taskKey(projectId, agentId);
  const tasks = scheduledTasks.get(key);
  if (tasks) {
    for (const task of tasks) {
      task.stop();
    }
    scheduledTasks.delete(key);
    console.log(`Unscheduled ${agentId}`);
  }
}

export function getScheduledAgents(): string[] {
  return Array.from(scheduledTasks.keys());
}
