#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Required env vars
# AGENT              - agent name: planner | plan-reviewer | developer | glasses-investigator
# LINEAR_API_KEY     - Linear API key
# GITHUB_ORG         - GitHub org (e.g. gobi-ai)
# SESSION_ID         - Claude session ID (passed by runner)
# PERMISSION_MODE    - Claude permission mode (default: bypassPermissions)
# MODEL              - Claude model override (optional)
# AGENT_TOOLS        - comma-separated list of tools: linear,sentry,langfuse,gcloud
# LANGFUSE_PUBLIC_KEY - Langfuse public key (when tools includes langfuse)
# LANGFUSE_SECRET_KEY - Langfuse secret key (when tools includes langfuse)
# LANGFUSE_HOST       - Langfuse host URL (default: https://cloud.langfuse.com)
# SENTRY_MCP_AUTH    - Enable Sentry MCP pre-authentication (default: false)
#
# Volumes expected:
#   ~/.gitconfig          - host ~/.gitconfig (read-only)
#   ~/.git-credentials    - host ~/.git-credentials (read-only)
#   ~/.ssh                - host ~/.ssh (read-only)
#   ~/.config/gh          - host ~/.config/gh (read-only) — gh auth for git credential helper
#   /agents               - host ~/monorepo/.runner/agents (read-only)
#   /source               - host ~/monorepo (read-only) — MD files
#   ~/.claude             - host ~/.claude — session continuity
# ---------------------------------------------------------------------------

: "${AGENT:?AGENT env var is required (planner|plan-reviewer|developer)}"
: "${LINEAR_API_KEY:?LINEAR_API_KEY is required}"
: "${SESSION_ID:?SESSION_ID is required}"

PERMISSION_MODE="${PERMISSION_MODE:-bypassPermissions}"
AGENT_FILE="/agents/${AGENT}.md"

if [[ ! -f "$AGENT_FILE" ]]; then
  echo "ERROR: Agent file not found: $AGENT_FILE"
  exit 1
fi

# ---------------------------------------------------------------------------
# Restore .claude.json if missing (can get lost when ~/.claude is mounted)
# ---------------------------------------------------------------------------
CLAUDE_JSON="${HOME}/.claude.json"
if [[ ! -f "$CLAUDE_JSON" ]]; then
  BACKUP=$(ls -t "${HOME}/.claude/backups/.claude.json.backup."* 2>/dev/null | head -1)
  if [[ -n "$BACKUP" ]]; then
    cp "$BACKUP" "$CLAUDE_JSON"
    echo "→ Restored .claude.json from backup"
  fi
fi

# ---------------------------------------------------------------------------
# Pull latest on all repos (shallow clone — use fetch + reset)
# ---------------------------------------------------------------------------
echo "→ Pulling latest..."
for repo_dir in /monorepo/gobi-*/; do
  repo=$(basename "$repo_dir")
  branch=$(git -C "$repo_dir" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "develop")
  git -C "$repo_dir" fetch origin --quiet 2>/dev/null && \
  git -C "$repo_dir" reset --hard "origin/${branch}" --quiet 2>/dev/null && \
  echo "  ✓ $repo" || echo "  ⚠ Could not update $repo, skipping"
done

# ---------------------------------------------------------------------------
# Copy shared MD files into /monorepo root
# ---------------------------------------------------------------------------
cp -f  /source/CLAUDE.md  /monorepo/CLAUDE.md  2>/dev/null || true
cp -f  /source/LINEAR.md  /monorepo/LINEAR.md  2>/dev/null || true
cp -rf /source/approvers  /monorepo/approvers  2>/dev/null || true
cp -rf /source/actors     /monorepo/actors     2>/dev/null || true

# ---------------------------------------------------------------------------
# Generate /monorepo/.mcp.json based on AGENT_TOOLS env var
# Claude Code reads MCP config from .mcp.json in the working directory,
# NOT from ~/.claude/settings.json.
# AGENT_TOOLS is a comma-separated list: linear,sentry,langfuse,gcloud
# ---------------------------------------------------------------------------
MCP_FILE="/monorepo/.mcp.json"

# Start building the mcpServers object
MCP_SERVERS=""
LANGFUSE_PLUGIN=""

IFS=',' read -ra TOOLS <<< "${AGENT_TOOLS:-}"
for tool in "${TOOLS[@]}"; do
  tool=$(echo "$tool" | xargs)  # trim whitespace
  case "$tool" in
    linear)
      MCP_SERVERS="${MCP_SERVERS}${MCP_SERVERS:+,}
    \"linear-server\": {
      \"command\": \"npx\",
      \"args\": [\"-y\", \"mcp-linear\"],
      \"env\": { \"LINEAR_API_KEY\": \"${LINEAR_API_KEY}\" }
    }"
      echo "  ✓ MCP: linear"
      ;;
    sentry)
      MCP_SERVERS="${MCP_SERVERS}${MCP_SERVERS:+,}
    \"sentry\": {
      \"command\": \"sentry-mcp\"
    }"
      echo "  ✓ MCP: sentry"
      ;;
    langfuse)
      # Langfuse uses a Claude Code skill + langfuse-cli (not MCP)
      export LANGFUSE_PUBLIC_KEY="${LANGFUSE_PUBLIC_KEY:-}"
      export LANGFUSE_SECRET_KEY="${LANGFUSE_SECRET_KEY:-}"
      export LANGFUSE_HOST="${LANGFUSE_HOST:-https://cloud.langfuse.com}"
      LANGFUSE_PLUGIN="--plugin-dir /plugins/langfuse"
      echo "  ✓ Langfuse skill + CLI"
      ;;
    gcloud)
      # gcloud needs a writable config dir; the mount at ~/.config/gcloud is read-only
      SA_MOUNT="/home/agent/.config/gcloud/service-account.json"
      export CLOUDSDK_CONFIG=/tmp/gcloud-config
      mkdir -p "$CLOUDSDK_CONFIG"
      if [[ -f "$SA_MOUNT" ]]; then
        cp "$SA_MOUNT" "$CLOUDSDK_CONFIG/service-account.json"
        gcloud auth activate-service-account --key-file="$CLOUDSDK_CONFIG/service-account.json" --quiet 2>/dev/null && \
          echo "  ✓ gcloud: service account activated" || \
          echo "  ⚠ gcloud: service account activation failed"
      else
        echo "  ⚠ gcloud: no service account key found at $SA_KEY"
      fi
      ;;
    "")
      # skip empty
      ;;
    *)
      echo "  ⚠ Unknown tool: $tool"
      ;;
  esac
done

cat > "$MCP_FILE" <<MCP_EOF
{
  "mcpServers": {${MCP_SERVERS}
  }
}
MCP_EOF
echo "→ Generated .mcp.json with tools: ${AGENT_TOOLS:-none}"

# ---------------------------------------------------------------------------
# Strip YAML frontmatter from agent file → /tmp/agent-prompt.md
# ---------------------------------------------------------------------------
awk '
  NR==1 && /^---$/ { in_fm=1; next }
  in_fm && /^---$/ { in_fm=0; next }
  !in_fm { print }
' "$AGENT_FILE" > /tmp/agent-prompt.md

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Agent      : $AGENT"
echo "  Tools      : ${AGENT_TOOLS:-none}"
echo "  Session ID : $SESSION_ID"
echo "  Permission : $PERMISSION_MODE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ---------------------------------------------------------------------------
# Build initial prompt — use trigger context if available
# ---------------------------------------------------------------------------
INITIAL_PROMPT="Begin."
if [[ -f /tmp/trigger-context.md ]]; then
  TRIGGER_CONTEXT=$(cat /tmp/trigger-context.md)
  INITIAL_PROMPT="${TRIGGER_CONTEXT}

Begin."
  echo "→ Trigger context loaded ($(wc -l < /tmp/trigger-context.md) lines)"
fi

# ---------------------------------------------------------------------------
# Run Claude
# ---------------------------------------------------------------------------
CLAUDE_ARGS=(
  --append-system-prompt-file /tmp/agent-prompt.md
  --print
  --verbose
  --output-format stream-json
  --session-id "$SESSION_ID"
  --permission-mode "$PERMISSION_MODE"
  -p "$INITIAL_PROMPT"
)

if [[ -n "${MODEL:-}" ]]; then
  CLAUDE_ARGS+=(--model "$MODEL")
fi

# Add Langfuse plugin if enabled
if [[ -n "${LANGFUSE_PLUGIN:-}" ]]; then
  CLAUDE_ARGS+=($LANGFUSE_PLUGIN)
fi

# ---------------------------------------------------------------------------
# Pre-authenticate Sentry MCP (optional, for non-interactive environments)
# ---------------------------------------------------------------------------
if [[ "${SENTRY_MCP_AUTH:-false}" == "true" ]]; then
  if [[ ! -f "${HOME}/.sentry/mcp.json" ]]; then
    echo "→ Authenticating Sentry MCP..."
    if npx @sentry/mcp-server@latest auth login; then
      echo "  ✓ Sentry MCP authenticated"
    else
      echo "  ⚠ Sentry MCP authentication failed, continuing without it"
    fi
  else
    echo "→ Sentry MCP already authenticated"
  fi
fi

exec claude "${CLAUDE_ARGS[@]}"
