#!/usr/bin/env bash
set -euo pipefail
#
# Register this runner's Linear webhook in the current workspace.
#
# Reads LINEAR_API_KEY and LINEAR_WEBHOOK_SECRET from .env.
# Deletes any existing webhooks pointing at $LINEAR_WEBHOOK_URL, then creates a fresh
# one bound to all public teams with resourceTypes=[Issue] and the same secret
# the server already expects (no env edit / restart needed).
#
# Usage:
#   ./setup-linear-workspace.sh
#

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
RUNNER_JSON="${SCRIPT_DIR}/runner.json"
LINEAR_API="https://api.linear.app/graphql"

if [ ! -f "$ENV_FILE" ]; then
  echo "error: $ENV_FILE not found" >&2
  exit 1
fi

# Load .env (only the vars we need, stripping quotes)
LINEAR_API_KEY=$(grep -E '^LINEAR_API_KEY=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' | tr -d "'")
LINEAR_WEBHOOK_URL=$(grep -E '^LINEAR_WEBHOOK_URL=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' | tr -d "'")
LINEAR_PROJECTS=$(grep -E '^LINEAR_PROJECTS=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' | tr -d "'")

: "${LINEAR_API_KEY:?LINEAR_API_KEY missing in .env}"
: "${LINEAR_WEBHOOK_URL:?LINEAR_WEBHOOK_URL missing in .env}"
: "${LINEAR_PROJECTS:?LINEAR_PROJECTS missing in .env (comma-separated project names)}"

# Generate a fresh webhook secret every run. After the webhook is created we
# write this value back into .env so the runner server sees it on next start.
LINEAR_WEBHOOK_SECRET="lin_wh_$(openssl rand -hex 32)"

gql() {
  # gql <query-json-string> -> prints response JSON
  curl -sS -X POST "$LINEAR_API" \
    -H "Authorization: $LINEAR_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$1"
}

jq_py() {
  # jq_py <python-expression-on-"d">
  python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"
}

echo "==> Verifying API key"
VIEWER=$(gql '{"query":"{ viewer { name email } organization { name urlKey } }"}')
ORG_NAME=$(echo "$VIEWER" | jq_py "d['data']['organization']['name']")
ORG_KEY=$(echo "$VIEWER" | jq_py "d['data']['organization']['urlKey']")
USER_NAME=$(echo "$VIEWER" | jq_py "d['data']['viewer']['name']")
USER_EMAIL=$(echo "$VIEWER" | jq_py "d['data']['viewer']['email']")
echo "    workspace: $ORG_NAME ($ORG_KEY)"
echo "    user:      $USER_NAME <$USER_EMAIL>"

echo "==> Listing teams"
TEAMS=$(gql '{"query":"{ teams { nodes { id key name } } }"}')
echo "$TEAMS" | jq_py "
'\n'.join('    - ' + t['key'] + ' (' + t['name'] + ') id=' + t['id'] for t in d['data']['teams']['nodes'])
"

echo "==> Deleting existing webhooks pointing at $LINEAR_WEBHOOK_URL"
EXISTING=$(gql '{"query":"{ webhooks { nodes { id label url } } }"}')
IDS=$(echo "$EXISTING" | python3 -c "
import json, sys
url = '$LINEAR_WEBHOOK_URL'
d = json.load(sys.stdin)
for w in d['data']['webhooks']['nodes']:
    if w['url'] == url:
        print(w['id'])
")
if [ -z "$IDS" ]; then
  echo "    (none)"
else
  for id in $IDS; do
    RES=$(gql "{\"query\":\"mutation { webhookDelete(id: \\\"$id\\\") { success } }\"}")
    OK=$(echo "$RES" | jq_py "d['data']['webhookDelete']['success']")
    echo "    deleted $id (success=$OK)"
  done
fi

echo "==> Creating webhook"
CREATE_PAYLOAD=$(python3 -c "
import json
print(json.dumps({
  'query': 'mutation(\$input: WebhookCreateInput!) { webhookCreate(input: \$input) { success webhook { id url enabled allPublicTeams resourceTypes } } }',
  'variables': {
    'input': {
      'label': 'runner ($ORG_KEY)',
      'url': '$LINEAR_WEBHOOK_URL',
      'resourceTypes': ['Issue'],
      'allPublicTeams': True,
      'enabled': True,
      'secret': '$LINEAR_WEBHOOK_SECRET',
    }
  }
}))
")
CREATE=$(gql "$CREATE_PAYLOAD")
SUCCESS=$(echo "$CREATE" | jq_py "d['data']['webhookCreate']['success']")
if [ "$SUCCESS" != "True" ]; then
  echo "    FAILED:"
  echo "$CREATE" | python3 -m json.tool >&2
  exit 1
fi
WEBHOOK_ID=$(echo "$CREATE" | jq_py "d['data']['webhookCreate']['webhook']['id']")
echo "    created webhook id=$WEBHOOK_ID"

echo "==> Updating LINEAR_WEBHOOK_SECRET in $ENV_FILE"
python3 - <<PYEOF
import re
path = "$ENV_FILE"
new_val = "$LINEAR_WEBHOOK_SECRET"
with open(path) as f:
    content = f.read()
if re.search(r'(?m)^LINEAR_WEBHOOK_SECRET=', content):
    content = re.sub(r'(?m)^LINEAR_WEBHOOK_SECRET=.*$', f'LINEAR_WEBHOOK_SECRET={new_val}', content)
else:
    if content and not content.endswith("\n"):
        content += "\n"
    content += f'LINEAR_WEBHOOK_SECRET={new_val}\n'
with open(path, "w") as f:
    f.write(content)
print(f"    wrote LINEAR_WEBHOOK_SECRET={new_val[:14]}...")
PYEOF

echo "==> Deleting all issues in workspace \"$ORG_NAME\""
# issueDelete is a soft-delete (sets archivedAt + trashed). Querying without
# includeArchived naturally excludes already-deleted issues, so the loop
# terminates once every active issue has been moved to trash.
DELETED=0
while :; do
  BATCH=$(gql '{"query":"{ issues(first: 100) { nodes { id identifier } } }"}')
  COUNT=$(echo "$BATCH" | jq_py "len(d['data']['issues']['nodes'])")
  if [ "$COUNT" = "0" ]; then break; fi
  IDS=$(echo "$BATCH" | python3 -c "import json,sys; d=json.load(sys.stdin); print('\n'.join(i['id'] for i in d['data']['issues']['nodes']))")
  for id in $IDS; do
    RES=$(gql "{\"query\":\"mutation { issueDelete(id: \\\"$id\\\") { success } }\"}")
    OK=$(echo "$RES" | jq_py "d['data']['issueDelete']['success']")
    if [ "$OK" = "True" ]; then
      DELETED=$((DELETED+1))
    else
      echo "    failed to delete $id: $RES" >&2
    fi
  done
  echo "    deleted $DELETED so far..."
done
echo "    total deleted: $DELETED"

echo "==> Syncing workflow states for each team"
python3 - <<PYEOF
import json, os, urllib.request

API_KEY = "$LINEAR_API_KEY"
API = "https://api.linear.app/graphql"

# Hardcoded workflow states. (name, linear-type, color)
# Linear type must be one of: triage, backlog, unstarted, started, completed, cancelled
# Colors pair awaiting/active states with the same hue (awaiting = lighter, active = brighter).
STATES = [
    # User-specified order (top):
    ("unstarted",                   "backlog",   "#bec2c8"),  # gray
    ("ai:awaiting-planner",         "unstarted", "#93c5fd"),  # light blue
    ("ai:awaiting-developer",       "unstarted", "#c4b5fd"),  # light purple
    ("ai:awaiting-answerer",        "unstarted", "#fcd34d"),  # light amber
    ("ai:awaiting-investigator",    "unstarted", "#fde047"),  # light yellow
    ("ai:awaiting-rebaser",         "unstarted", "#fca5a5"),  # light red
    ("done",                        "completed", "#5e6ad2"),  # indigo
    ("cancelled",                   "canceled",  "#95a5a6"),  # gray
    ("ai:awaiting-plan-reviewer",   "unstarted", "#67e8f9"),  # light cyan
    ("ai:awaiting-pr-reviewer",     "unstarted", "#f0abfc"),  # light magenta
    # Everything else, in previous relative order:
    ("human:awaiting",              "unstarted", "#ec4899"),  # pink — needs human
    ("human:awaiting-answer",       "unstarted", "#f472b6"),  # rose — ai asked, waiting on human reply
    ("human:awaiting-approval",     "completed", "#22c55e"),  # green — ready to merge
    ("ai:planning",                 "started",   "#3b82f6"),  # blue
    ("ai:plan-reviewing",           "started",   "#06b6d4"),  # cyan
    ("ai:developing",               "started",   "#8b5cf6"),  # purple
    ("ai:pr-reviewing",             "started",   "#d946ef"),  # magenta
    ("ai:answering",                "started",   "#f59e0b"),  # amber
    ("ai:investigating",            "started",   "#eab308"),  # yellow
    ("ai:rebasing",                 "started",   "#ef4444"),  # red
]

def gql(query, variables=None):
    body = json.dumps({"query": query, "variables": variables or {}}).encode()
    req = urllib.request.Request(API, data=body, headers={
        "Authorization": API_KEY,
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

teams = gql("{ teams { nodes { id key name } } }")["data"]["teams"]["nodes"]
for t in teams:
    print(f"    team {t['key']} ({t['name']})")
    existing = gql(
        "query(\$tid: ID!){ workflowStates(filter:{team:{id:{eq:\$tid}}}){ nodes { id name type } } }",
        {"tid": t["id"]},
    )["data"]["workflowStates"]["nodes"]
    existing_by_name = {s["name"]: s for s in existing}
    for pos, (name, stype, color) in enumerate(STATES):
        if name in existing_by_name:
            # Enforce position (and color/type) on every run so reordering
            # the STATES list actually propagates to Linear.
            sid = existing_by_name[name]["id"]
            res = gql(
                "mutation(\$id: String!, \$input: WorkflowStateUpdateInput!){ workflowStateUpdate(id: \$id, input: \$input){ success } }",
                {"id": sid, "input": {
                    "position": float(pos),
                    "color": color,
                }},
            )
            if "errors" in res:
                print(f"      ! update {name}: {res['errors'][0]['message']}")
            else:
                print(f"      = {name} (pos={pos})")
            continue
        res = gql(
            "mutation(\$input: WorkflowStateCreateInput!){ workflowStateCreate(input: \$input){ success workflowState { id name } } }",
            {"input": {
                "teamId": t["id"],
                "name": name,
                "type": stype,
                "color": color,
                "position": float(pos),
            }},
        )
        if "errors" in res:
            print(f"      ! {name}: {res['errors'][0]['message']}")
        else:
            ok = res["data"]["workflowStateCreate"]["success"]
            print(f"      + {name} ({stype}, pos={pos})" if ok else f"      ! {name}: failed")

    # Archive any state not in the hardcoded list.
    # Re-fetch so the newly created ones are present (Linear won't archive the
    # last state of a required type, so create-then-archive is the safe order).
    keep = {name for name, _, _ in STATES}
    current = gql(
        "query(\$tid: ID!){ workflowStates(filter:{team:{id:{eq:\$tid}}}){ nodes { id name } } }",
        {"tid": t["id"]},
    )["data"]["workflowStates"]["nodes"]
    for s in current:
        if s["name"] in keep:
            continue
        res = gql(
            "mutation(\$id: String!){ workflowStateArchive(id: \$id){ success } }",
            {"id": s["id"]},
        )
        if "errors" in res:
            print(f"      ! archive {s['name']}: {res['errors'][0]['message']}")
        else:
            print(f"      - archived {s['name']}")

    # Set "unstarted" as the team's default state for new issues
    by_name = {s["name"]: s["id"] for s in current}
    default_id = by_name.get("unstarted")
    if default_id:
        res = gql(
            "mutation(\$tid: String!, \$sid: String!){ teamUpdate(id: \$tid, input: { defaultIssueStateId: \$sid }){ success } }",
            {"tid": t["id"], "sid": default_id},
        )
        if "errors" in res:
            print(f"      ! set default state: {res['errors'][0]['message']}")
        else:
            print(f"      * default state = unstarted")
    else:
        print(f"      ! 'unstarted' state not found — cannot set default")

# Replace all Linear projects with the list from LINEAR_PROJECTS in .env.
# All teams in the workspace get added to each project.
PROJECTS = [p.strip() for p in "$LINEAR_PROJECTS".split(",") if p.strip()]
all_team_ids = [t["id"] for t in teams]
existing_projects = gql("{ projects { nodes { id name } } }")["data"]["projects"]["nodes"]
print("  projects:")
for p in existing_projects:
    if p["name"] in PROJECTS:
        continue
    res = gql(
        "mutation(\$id: String!){ projectDelete(id: \$id){ success } }",
        {"id": p["id"]},
    )
    if "errors" in res:
        print(f"    ! delete {p['name']}: {res['errors'][0]['message']}")
    else:
        print(f"    - deleted {p['name']}")
existing_project_names = {p["name"] for p in existing_projects if p["name"] in PROJECTS}
for pname in PROJECTS:
    if pname in existing_project_names:
        print(f"    = {pname}")
        continue
    res = gql(
        "mutation(\$input: ProjectCreateInput!){ projectCreate(input: \$input){ success project { id name } } }",
        {"input": {"name": pname, "teamIds": all_team_ids}},
    )
    if "errors" in res:
        print(f"    ! {pname}: {res['errors'][0]['message']}")
    else:
        ok = res["data"]["projectCreate"]["success"]
        print(f"    + {pname}" if ok else f"    ! {pname}: failed")
PYEOF

echo "==> Cleaning per-project issue state (sessions, executions, logs)"
if [ ! -f "$RUNNER_JSON" ]; then
  echo "    warning: $RUNNER_JSON not found, skipping"
else
  TARGET_DIRS=$(python3 -c "
import json
with open('$RUNNER_JSON') as f:
    d = json.load(f)
for p in d.get('projects', []):
    print(p['targetDir'])
")
  for dir in $TARGET_DIRS; do
    STATE_DIR="$dir/.runner"
    if [ ! -d "$STATE_DIR" ]; then
      echo "    $STATE_DIR: (missing, skip)"
      continue
    fi
    if [ -d "$STATE_DIR/sessions" ]; then
      N=$(find "$STATE_DIR/sessions" -maxdepth 1 -mindepth 1 | wc -l)
      rm -rf "$STATE_DIR/sessions"/*
      echo "    $STATE_DIR/sessions: removed $N entries"
    fi
    if [ -f "$STATE_DIR/executions.json" ]; then
      echo "[]" > "$STATE_DIR/executions.json"
      echo "    $STATE_DIR/executions.json: reset to []"
    fi
    if [ -d "$STATE_DIR/logs" ]; then
      N=$(find "$STATE_DIR/logs" -maxdepth 1 -type f -name '*.log' | wc -l)
      find "$STATE_DIR/logs" -maxdepth 1 -type f -name '*.log' -delete
      echo "    $STATE_DIR/logs: removed $N log files"
    fi
  done
fi

echo "==> Restarting runner server"
# `tsx watch` auto-reloads on source changes and re-runs dotenv config() on
# restart, so touching the entrypoint is enough to pick up the new secret.
WATCH_PID=$(pgrep -f 'tsx watch src/server/index.ts' | head -1 || true)
if [ -n "$WATCH_PID" ]; then
  touch "${SCRIPT_DIR}/src/server/index.ts"
  echo "    touched src/server/index.ts (tsx watch pid=$WATCH_PID will auto-reload)"
else
  echo "    WARNING: no 'tsx watch' process found — start the server manually"
  echo "    (npm run dev) so it picks up the new LINEAR_WEBHOOK_SECRET"
fi

echo
echo "==> Done."
echo "    Webhook URL: $LINEAR_WEBHOOK_URL"
echo "    Bound to:    all public teams in \"$ORG_NAME\""
echo "    Secret:      rotated and written to .env"
echo
echo "Next: trigger a status change on any issue in $ORG_KEY and tail /tmp/runner-server.log"
