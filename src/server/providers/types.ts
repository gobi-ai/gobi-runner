export interface AIProvider {
  readonly id: string;
  readonly displayName: string;
  readonly models: ProviderModel[];

  /** Environment variables to pass into Docker containers */
  getRequiredEnvVars(): Record<string, string>;

  /** Build CLI command + args to run inside the container */
  buildCommand(opts: CommandOpts): ProviderCommand;

  /** Build CLI command for session resume (null if unsupported) */
  buildResumeCommand?(opts: ResumeOpts): ProviderCommand | null;

  /** Parse a single stdout line into structured events */
  parseOutputLine(line: string): ProviderEvent[];

  /** Provider-specific Docker volume mounts */
  getExtraVolumeMounts(homeDir: string): string[];
}

export interface ProviderModel {
  id: string;
  label: string;
}

export interface CommandOpts {
  prompt: string;
  sessionId: string;
  permissionMode: string;
  model?: string;
  systemPromptFile?: string;
  additionalFlags?: string[];
}

export interface ResumeOpts {
  prompt: string;
  sessionId: string;
  permissionMode: string;
  model?: string;
}

export interface ProviderCommand {
  binary: string;
  args: string[];
}

export type ProviderEvent =
  | { type: "text"; text: string }
  | { type: "tool_use"; name: string; input: Record<string, unknown> }
  | { type: "cost"; costUsd: number }
  | { type: "error"; message: string }
  | { type: "raw"; text: string };
