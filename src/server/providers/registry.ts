import type { AIProvider } from "./types.js";
import { ClaudeProvider } from "./claude.js";
import { CopilotProvider } from "./copilot.js";

const providers = new Map<string, AIProvider>();

providers.set("claude", new ClaudeProvider());
providers.set("copilot", new CopilotProvider());

export function getProvider(id: string): AIProvider {
  const p = providers.get(id);
  if (!p) {
    throw new Error(`Unknown provider: ${id}. Available: ${[...providers.keys()].join(", ")}`);
  }
  return p;
}

export function listProviders(): AIProvider[] {
  return [...providers.values()];
}

export function getDefaultProvider(): AIProvider {
  return providers.get("claude")!;
}
