# syntax=docker/dockerfile:1
FROM node:20-slim

# System dependencies + GitHub CLI
RUN apt-get update && apt-get install -y \
    git \
    curl \
    jq \
    gnupg \
    openssh-client \
    ca-certificates \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI + MCP servers + Langfuse CLI
RUN npm install -g @anthropic-ai/claude-code mcp-linear @sentry/mcp-server langfuse-cli

# Install Google Cloud SDK (for gcloud, gsutil, kubectl)
RUN curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg | gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" > /etc/apt/sources.list.d/google-cloud-sdk.list \
    && apt-get update && apt-get install -y google-cloud-cli google-cloud-cli-gke-gcloud-auth-plugin \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user with uid=1000 to match host user (so mounted ~/.claude.json is readable)
# node:20-slim ships a 'node' user at uid=1000 — reuse that uid for 'agent'
RUN userdel node && useradd -m -u 1000 -s /bin/bash agent

# Create workspace directory
RUN mkdir -p /monorepo && chown agent:agent /monorepo

# Langfuse skill plugin (for langfuse-cli based data access)
RUN git clone --depth=1 https://github.com/langfuse/skills.git /plugins/langfuse \
    && mv /plugins/langfuse/.cursor-plugin /plugins/langfuse/.claude-plugin

# Switch to non-root for everything else
USER agent

# Git identity
RUN git config --global user.email "agent@runner.local" && \
    git config --global user.name "Agent Runner"

# Entrypoint + provider-specific scripts
COPY --chmod=755 entrypoint.sh /entrypoint.sh
COPY --chmod=755 entrypoints/ /entrypoints/

WORKDIR /monorepo

ENTRYPOINT ["/entrypoint.sh"]
