import fs from "fs";
import type {
  AIProvider,
  ProviderModel,
  ProviderCommand,
  CommandOpts,
  ResumeOpts,
  ProviderEvent,
} from "./types.js";

export class ClaudeProvider implements AIProvider {
  readonly id = "claude";
  readonly displayName = "Claude Code";
  readonly models: ProviderModel[] = [
    { id: "", label: "Default" },
    { id: "sonnet", label: "Sonnet" },
    { id: "opus", label: "Opus" },
    { id: "haiku", label: "Haiku" },
  ];

  getRequiredEnvVars(): Record<string, string> {
    return {};
  }

  buildCommand(opts: CommandOpts): ProviderCommand {
    const args: string[] = [];

    if (opts.systemPromptFile) {
      args.push("--append-system-prompt-file", opts.systemPromptFile);
    }

    args.push(
      "--print",
      "--verbose",
      "--output-format", "stream-json",
      "--session-id", opts.sessionId,
      "--permission-mode", opts.permissionMode,
      "-p", opts.prompt,
    );

    if (opts.model) {
      args.push("--model", opts.model);
    }

    if (opts.additionalFlags) {
      args.push(...opts.additionalFlags);
    }

    return { binary: "claude", args };
  }

  buildResumeCommand(opts: ResumeOpts): ProviderCommand {
    const args = [
      "--print",
      "--verbose",
      "--output-format", "stream-json",
      "--resume", opts.sessionId,
      "--permission-mode", opts.permissionMode,
      "-p", opts.prompt,
    ];

    if (opts.model) {
      args.push("--model", opts.model);
    }

    return { binary: "claude", args };
  }

  parseOutputLine(line: string): ProviderEvent[] {
    try {
      const parsed = JSON.parse(line);

      if (parsed.type === "assistant" && parsed.message?.content) {
        const events: ProviderEvent[] = [];
        for (const block of parsed.message.content) {
          if (block.type === "text") {
            events.push({ type: "text", text: block.text });
          } else if (block.type === "tool_use") {
            events.push({
              type: "tool_use",
              name: block.name,
              input: block.input || {},
            });
          }
        }
        return events;
      }

      if (parsed.type === "result") {
        return [{ type: "cost", costUsd: parsed.cost_usd ?? 0 }];
      }

      return [];
    } catch {
      return [{ type: "raw", text: line }];
    }
  }

  getExtraVolumeMounts(homeDir: string): string[] {
    const mounts = [
      "-v", `${homeDir}/.claude:/home/agent/.claude`,
      "-v", `${homeDir}/.claude.json:/home/agent/.claude.json`,
    ];

    if (fs.existsSync(`${homeDir}/.sentry`)) {
      mounts.push("-v", `${homeDir}/.sentry:/home/agent/.sentry:ro`);
    }

    if (fs.existsSync(`${homeDir}/.config/gcloud/service-account.json`)) {
      mounts.push("-v", `${homeDir}/.config/gcloud/service-account.json:/home/agent/.config/gcloud/service-account.json:ro`);
    }

    return mounts;
  }
}
