#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Required env vars
# AGENT              - agent name (matches filename in /agents/<name>.md)
# LINEAR_API_KEY     - Linear API key
# SESSION_ID         - session ID (passed by runner)
# PERMISSION_MODE    - permission mode (default: bypassPermissions)
# MODEL              - model override (optional)
# PROVIDER           - AI provider: claude | copilot (default: claude)
# AGENT_TOOLS        - comma-separated list of tools: linear,sentry,langfuse,gcloud
# GITHUB_REPOS       - space-separated list of repos to clone (full "org/repo" paths)
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
#   /agents               - host <targetDir>/.runner/agents (read-only)
#   /source               - host <targetDir> (read-only) — shared MD files
#   /local/<name>         - host local dirs (read-only, if configured)
#   Provider-specific volumes are mounted by session-manager.ts
# ---------------------------------------------------------------------------

: "${AGENT:?AGENT env var is required}"
: "${LINEAR_API_KEY:?LINEAR_API_KEY is required}"
: "${SESSION_ID:?SESSION_ID is required}"

PERMISSION_MODE="${PERMISSION_MODE:-bypassPermissions}"
PROVIDER="${PROVIDER:-claude}"
AGENT_FILE="/agents/${AGENT}.md"

if [[ ! -f "$AGENT_FILE" ]]; then
  echo "ERROR: Agent file not found: $AGENT_FILE"
  exit 1
fi

# ---------------------------------------------------------------------------
# Clone or update GitHub repos
# GITHUB_REPOS contains full "org/repo" paths (e.g. "myorg/backend myorg/frontend")
# ---------------------------------------------------------------------------
if [[ -n "${GITHUB_REPOS:-}" ]]; then
  echo "→ Syncing GitHub repos..."
  for full_repo in ${GITHUB_REPOS}; do
    repo_name=$(basename "$full_repo")
    repo_dir="/monorepo/${repo_name}"
    if [[ -d "$repo_dir/.git" ]]; then
      # Repo already exists (baked into image) — pull latest develop
      git -C "$repo_dir" fetch origin --quiet 2>/dev/null && \
      git -C "$repo_dir" checkout develop --quiet 2>/dev/null && \
      git -C "$repo_dir" reset --hard origin/develop --quiet 2>/dev/null && \
      echo "  ✓ ${repo_name} (pulled develop)" || echo "  ⚠ Could not pull develop for ${repo_name}"
    else
      # Not in image — fresh clone on develop
      git clone --depth=1 --branch develop "https://github.com/${full_repo}.git" "$repo_dir" 2>/dev/null && \
      echo "  ✓ ${repo_name} (cloned develop)" || echo "  ⚠ Could not clone ${full_repo}"
    fi
  done
fi

# ---------------------------------------------------------------------------
# Symlink local dirs into /monorepo (they're mounted at /local/<name>)
# ---------------------------------------------------------------------------
if [[ -d /local ]]; then
  for dir in /local/*/; do
    name=$(basename "$dir")
    if [[ ! -e "/monorepo/${name}" ]]; then
      ln -s "$dir" "/monorepo/${name}"
      echo "  ✓ ${name} (local)"
    fi
  done
fi

# ---------------------------------------------------------------------------
# Copy shared MD files into /monorepo root
# ---------------------------------------------------------------------------
cp -f  /source/CLAUDE.md  /monorepo/CLAUDE.md  2>/dev/null || true
cp -f  /source/LINEAR.md  /monorepo/LINEAR.md  2>/dev/null || true
cp -rf /source/approvers  /monorepo/approvers  2>/dev/null || true
cp -rf /source/actors     /monorepo/actors     2>/dev/null || true

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
echo "  Provider   : $PROVIDER"
echo "  Tools      : ${AGENT_TOOLS:-none}"
echo "  Session ID : $SESSION_ID"
echo "  Permission : $PERMISSION_MODE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ---------------------------------------------------------------------------
# Build initial prompt — use trigger context if available
# ---------------------------------------------------------------------------
export INITIAL_PROMPT="Begin."
if [[ -f /tmp/trigger-context.md ]]; then
  TRIGGER_CONTEXT=$(cat /tmp/trigger-context.md)
  INITIAL_PROMPT="${TRIGGER_CONTEXT}

Begin."
  echo "→ Trigger context loaded ($(wc -l < /tmp/trigger-context.md) lines)"
fi

# ---------------------------------------------------------------------------
# Delegate to provider-specific entrypoint
# ---------------------------------------------------------------------------
PROVIDER_SCRIPT="/entrypoints/${PROVIDER}.sh"
if [[ ! -f "$PROVIDER_SCRIPT" ]]; then
  echo "ERROR: Unknown provider: $PROVIDER (no script at $PROVIDER_SCRIPT)"
  exit 1
fi

source "$PROVIDER_SCRIPT"
