#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# GitHub Copilot provider entrypoint
# Called by the main entrypoint.sh after common setup
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Verify GitHub CLI authentication
# ---------------------------------------------------------------------------
if command -v gh &>/dev/null; then
  gh auth status 2>/dev/null && echo "→ GitHub CLI authenticated" || echo "⚠ GitHub CLI not authenticated"
else
  echo "⚠ GitHub CLI (gh) not found"
fi

# ---------------------------------------------------------------------------
# Run Copilot agent wrapper
# ---------------------------------------------------------------------------
COPILOT_ARGS=(
  --print
  --output-format stream-json
  --session-id "$SESSION_ID"
  -p "$INITIAL_PROMPT"
)

if [[ -n "${MODEL:-}" ]]; then
  COPILOT_ARGS+=(--model "$MODEL")
fi

if [[ -f /tmp/agent-prompt.md ]]; then
  COPILOT_ARGS+=(--system-prompt-file /tmp/agent-prompt.md)
fi

exec copilot-agent "${COPILOT_ARGS[@]}"
