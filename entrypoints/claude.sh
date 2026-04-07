#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Claude Code provider entrypoint
# Called by the main entrypoint.sh after common setup
# ---------------------------------------------------------------------------

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
# Clear stale MCP auth cache — prevents Claude from skipping MCP servers
# that previously failed to connect (e.g. due to missing env vars)
# ---------------------------------------------------------------------------
rm -f "${HOME}/.claude/mcp-needs-auth-cache.json"

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
    \"linear\": {
      \"type\": \"http\",
      \"url\": \"https://mcp.linear.app/mcp\",
      \"headers\": { \"Authorization\": \"Bearer ${LINEAR_API_KEY}\" }
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
        echo "  ⚠ gcloud: no service account key found at $SA_MOUNT"
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

exec claude "${CLAUDE_ARGS[@]}"
