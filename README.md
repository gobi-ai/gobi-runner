# Agent Runner

Run [Claude Code](https://docs.anthropic.com/en/docs/claude-code) agents in Docker containers, triggered by cron schedules or Linear webhooks. Monitor everything through a web dashboard.

## Prerequisites

| Requirement | Setup |
|---|---|
| Node.js 20+ | [nodejs.org](https://nodejs.org) or `nvm install 20` |
| Docker | Running and accessible to your user |
| GitHub CLI | `gh auth login` |
| Claude Code CLI | `npm install -g @anthropic-ai/claude-code` then `claude` to authenticate |
| Git credentials | `gh auth setup-git` (sets up `~/.gitconfig` and `~/.git-credentials`) |
| Linear API Key | [Linear Settings → API → Personal API Keys](https://linear.app/settings/api) |

## Quick Start

```bash
git clone https://github.com/YOUR_USERNAME/agent-runner.git
cd agent-runner
npm install

# Configure
cp .env.example .env              # Edit: LINEAR_API_KEY (and optional settings)
cp runner.json.example runner.json # Edit: project path and name

# Build and run
npm run docker:build       # Builds generic agent container image
npm run build              # Builds web UI
npm run start              # → http://localhost:3456
```

### `.env`

```bash
# Required
LINEAR_API_KEY=lin_api_...         # Linear API key

# Optional
RUNNER_PASSWORD=                   # Dashboard password (omit = no auth)
LINEAR_WEBHOOK_SECRET=             # Linear webhook HMAC verification
LANGFUSE_PUBLIC_KEY=               # Langfuse observability
LANGFUSE_SECRET_KEY=
LANGFUSE_HOST=https://cloud.langfuse.com
```

### `runner.json`

```json
{
  "projects": [
    {
      "id": "my-project",
      "name": "My Project",
      "targetDir": "/home/you/my-project",
      "dockerImage": "agent-runner:latest"
    }
  ]
}
```

### `.runner/config.json`

Each project has a config file at `<targetDir>/.runner/config.json` that defines what code agents can access:

```json
{
  "githubRepos": ["myorg/backend", "myorg/frontend"],
  "localDirs": ["/home/you/shared-lib", "/home/you/docs"]
}
```

| Field | Description |
|---|---|
| `githubRepos` | GitHub repos to clone into containers (full `org/repo` paths). Cloned at runtime via `git clone --depth=1`. |
| `localDirs` | Local directories to mount read-only into containers at `/local/<name>`. Symlinked into `/monorepo/`. |

Both are optional. You can use GitHub repos, local dirs, or both together.

## Creating an Agent

Create a Markdown file in `<targetDir>/.runner/agents/`:

```markdown
---
name: Daily Code Reviewer
enabled: true
model: claude-sonnet-4-20250514
permissionMode: bypassPermissions
tools:
  - linear
triggers:
  - type: cron
    schedule: "0 9 * * 1-5"
  - type: linear-webhook
    statusTo:
      - "In Review"
    teams:
      - "ENG"
---

You are a code reviewer. Review open pull requests and post feedback.
```

### Frontmatter Reference

| Field | Description |
|---|---|
| `name` | Display name |
| `enabled` | Activate triggers |
| `model` | Claude model (optional) |
| `permissionMode` | `bypassPermissions`, `default`, etc. |
| `tools` | `linear`, `sentry`, `langfuse`, `gcloud` |
| `triggers` | Cron and/or Linear webhook triggers |

### Trigger Types

**Cron:** `{ type: cron, schedule: "0 9 * * *" }`

**Linear webhook:** `{ type: linear-webhook, statusTo: ["Done"], teams: ["ENG"], labels: ["bug"], projects: ["Backend"] }` — all filters are optional.

## Optional Add-ons

| Add-on | Setup |
|---|---|
| **Sentry** | `npx @sentry/mcp-server@latest auth login` (one-time browser OAuth) |
| **Google Cloud** | Place service account key at `~/.config/gcloud/service-account.json` |
| **Langfuse** | Set `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST` in `.env` |
| **Linear Webhooks** | Linear Settings → API → Webhooks → URL: `https://<host>/api/webhooks/linear` |

## Development

```bash
npm run dev          # Backend :3456 with hot reload
npm run dev:client   # Frontend :5174 (proxies /api to :3456)
```

---

## Setup with Claude

Give this prompt to Claude Code to get set up interactively:

<details>
<summary>Click to expand</summary>

```
I want you to help me set up Agent Runner — a self-hosted platform for running
Claude Code agents in Docker containers.

The repo is at: https://github.com/YOUR_USERNAME/agent-runner

Read the README.md first, then walk me through setup step by step.

## Step 1: Clone and install
Clone the repo and run npm install.

## Step 2: Prerequisites check
Check each one. If any fail, stop and help me fix it before moving on.

1. node --version (need 20+. If missing → tell me to install via nvm or nodejs.org)
2. docker info (if not running or not installed → walk me through installing Docker for my OS)
3. gh auth status (if not logged in → run gh auth login and wait for me to complete the browser flow)
4. After gh is authenticated: ensure git credentials are set up — run gh auth setup-git
5. claude --version (if missing → npm install -g @anthropic-ai/claude-code, then run claude and wait for me to authenticate)

These steps may require me to do things in the browser. Wait for me to confirm
each one before proceeding.

## Step 3: Core configuration
Ask me:
- Linear API key (get it from Linear Settings → API → Personal API Keys)
- Do I want a dashboard password? (optional — if omitted the UI has no auth)

Then create .env from .env.example with my answers.

## Step 4: Add-ons
Show me the available add-ons and ask which I want. I can pick multiple:
- **Sentry** — error tracking via MCP (requires one-time browser auth)
- **Google Cloud** — gcloud/gsutil/kubectl in agents (requires service account JSON key)
- **Langfuse** — LLM observability (requires API keys)
- **Linear webhooks** — auto-trigger agents on issue changes (requires public URL)

For each one I pick, walk me through the setup right away before moving on.
- Sentry: run npx @sentry/mcp-server@latest auth login → wait for me to finish browser auth
- Google Cloud: ask me for the path to my service account key, copy it to ~/.config/gcloud/service-account.json
- Langfuse: ask for LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_HOST and add to .env
- Linear webhooks: ask for my public hostname, tell me to create a webhook in Linear Settings → API → Webhooks pointing to https://<host>/api/webhooks/linear, ask for the signing secret and add to .env

## Step 5: Project setup
Agent Runner supports multiple projects. Each project has its own targetDir,
agents, logs, and state. Start by setting up at least one.

For each project, ask me:
- What should we call this project?
- Where should the project root live on disk?
  - If I have an existing local folder: ask for the absolute path
  - If I want to start fresh: ask where to create it, then mkdir

Then ask: how should agents access source code for this project?
- **GitHub repos** — cloned into containers at runtime (full "org/repo" paths, e.g. "myorg/backend")
- **Local directories** — mounted read-only into containers (absolute paths on host)
- **Both** — GitHub repos are cloned, local dirs are mounted alongside

Create runner.json from runner.json.example with the project config.
Create <targetDir>/.runner/config.json with the githubRepos and/or localDirs.
Create the .runner/agents/ directory inside each project if it doesn't exist.
After the first project, ask: "Want to add another project?"

## Step 6: Build
- Build the Docker image: npm run docker:build
- Build the web UI: npm run build

## Step 7: First agent
Ask me: what is the first agent you'd like to create?

Ask for:
- A name for the agent
- What it should do (describe in plain language)
- How should it be triggered? Options:
  - Cron schedule (e.g., "every weekday at 9am" → 0 9 * * 1-5)
  - Linear webhook (e.g., "when an issue moves to In Review")
  - Both

Then create the agent markdown file at <targetDir>/.runner/agents/<agent-id>.md with:
- YAML frontmatter: name, enabled: true, model, permissionMode: bypassPermissions,
  tools (include the add-ons from step 4), triggers
- Prompt body based on what I described

## Step 8: Launch
Start the server: npm run start
Tell me to open http://localhost:3456 in my browser.
Ask me to confirm that I can see the dashboard and that the agent I created shows up.

Be conversational. Ask one question at a time unless I said to batch them.
Don't dump everything at once. Wait for my confirmation on steps that need
browser interaction.
```

</details>

## License

MIT
