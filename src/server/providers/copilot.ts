import type {
  AIProvider,
  ProviderModel,
  ProviderCommand,
  CommandOpts,
  ResumeOpts,
  ProviderEvent,
} from "./types.js";

export class CopilotProvider implements AIProvider {
  readonly id = "copilot";
  readonly displayName = "GitHub Copilot";
  readonly models: ProviderModel[] = [
    { id: "", label: "Default" },
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "claude-3.5-sonnet", label: "Claude 3.5 Sonnet (via Copilot)" },
  ];

  getRequiredEnvVars(): Record<string, string> {
    return {
      GITHUB_TOKEN: process.env.GITHUB_TOKEN ?? "",
    };
  }

  buildCommand(opts: CommandOpts): ProviderCommand {
    const args: string[] = [
      "--print",
      "--output-format", "stream-json",
      "--session-id", opts.sessionId,
      "-p", opts.prompt,
    ];

    if (opts.systemPromptFile) {
      args.unshift("--system-prompt-file", opts.systemPromptFile);
    }

    if (opts.model) {
      args.push("--model", opts.model);
    }

    if (opts.additionalFlags) {
      args.push(...opts.additionalFlags);
    }

    return { binary: "copilot-agent", args };
  }

  buildResumeCommand(_opts: ResumeOpts): null {
    // Copilot does not support session resume
    return null;
  }

  parseOutputLine(line: string): ProviderEvent[] {
    try {
      const parsed = JSON.parse(line);

      if (parsed.type === "text") {
        return [{ type: "text", text: parsed.text }];
      }

      if (parsed.type === "tool_use") {
        return [{
          type: "tool_use",
          name: parsed.name,
          input: parsed.input || {},
        }];
      }

      if (parsed.type === "cost") {
        return [{ type: "cost", costUsd: parsed.costUsd ?? 0 }];
      }

      if (parsed.type === "result") {
        return [{ type: "cost", costUsd: parsed.cost_usd ?? 0 }];
      }

      if (parsed.type === "error") {
        return [{ type: "error", message: parsed.message ?? line }];
      }

      // Fallback: try Claude-compatible format for interoperability
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

      return [];
    } catch {
      return [{ type: "raw", text: line }];
    }
  }

  getExtraVolumeMounts(homeDir: string): string[] {
    return [
      "-v", `${homeDir}/.config/gh:/home/agent/.config/gh:ro`,
    ];
  }
}
