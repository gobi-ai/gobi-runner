#!/usr/bin/env bash
set -euo pipefail
#
# Build a per-project Docker image for each project in runner.json.
# Image name: agent-runner-<projectId>:latest
# Repos are read from each project's .runner/config.json (githubRepos).
#
# Usage: GH_TOKEN=... ./build-images.sh
#   or:  GH_TOKEN=$(gh auth token) ./build-images.sh
#

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNNER_JSON="${SCRIPT_DIR}/runner.json"

: "${GH_TOKEN:?GH_TOKEN is required}"

if [[ ! -f "$RUNNER_JSON" ]]; then
  echo "ERROR: runner.json not found at $RUNNER_JSON"
  exit 1
fi

PROJECT_COUNT=$(jq '.projects | length' "$RUNNER_JSON")

for i in $(seq 0 $((PROJECT_COUNT - 1))); do
  PROJECT_ID=$(jq -r ".projects[$i].id" "$RUNNER_JSON")
  TARGET_DIR=$(jq -r ".projects[$i].targetDir" "$RUNNER_JSON")
  IMAGE_NAME=$(jq -r ".projects[$i].dockerImage // \"agent-runner-${PROJECT_ID}:latest\"" "$RUNNER_JSON")
  CONFIG_JSON="${TARGET_DIR}/.runner/config.json"

  ROOT_REPO=""
  REPOS=""
  if [[ -f "$CONFIG_JSON" ]]; then
    ROOT_REPO=$(jq -r '.rootRepo // ""' "$CONFIG_JSON")
    REPOS=$(jq -r '.githubRepos // [] | join(" ")' "$CONFIG_JSON")
  fi

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Project : ${PROJECT_ID}"
  echo "  Image   : ${IMAGE_NAME}"
  echo "  Root    : ${ROOT_REPO:-none}"
  echo "  Repos   : ${REPOS:-none}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  DOCKER_BUILDKIT=1 docker build \
    --secret id=gh_token,env=GH_TOKEN \
    --build-arg ROOT_REPO="${ROOT_REPO}" \
    --build-arg GITHUB_REPOS="${REPOS}" \
    -t "${IMAGE_NAME}" \
    "${SCRIPT_DIR}"

  echo "✓ Built ${IMAGE_NAME}"
  echo ""
done
