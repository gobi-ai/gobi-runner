import React, { useState, useEffect, useCallback, useRef } from "react";
import { api, type LinearIssue, type Project } from "../api";


interface Props {
  project: Project;
  onSessionChange?: () => void;
  /** Incremented externally to trigger a refresh */
  refreshTrigger?: number;
}

const stateColors: Record<string, string> = {
  started: "#FAA700",
  unstarted: "#7D7A75",
  backlog: "#4C4C4A",
  triage: "#0A85D1",
  completed: "#00AC47",
  cancelled: "#EA4E43",
};

const stateTypeOrder = ["triage", "backlog", "unstarted", "started", "completed", "cancelled"];

function StatusDropdown({ project, issue, onChanged }: {
  project: Project;
  issue: LinearIssue;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  const states = issue.team.states.nodes
    .slice()
    .sort((a, b) => stateTypeOrder.indexOf(a.type) - stateTypeOrder.indexOf(b.type));

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      setDropUp(spaceBelow < 270);
    }
    setOpen(!open);
  };

  const handleSelect = async (stateId: string) => {
    if (stateId === issue.state.id) { setOpen(false); return; }
    setOpen(false);
    setUpdating(true);
    try {
      await api.updateIssueStatus(project.id, issue.identifier, stateId);
      onChanged();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setUpdating(false);
    }
  };

  const color = stateColors[issue.state.type] ?? "var(--fg-muted)";

  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <button
        ref={btnRef}
        onClick={handleOpen}
        disabled={updating}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "2px 8px",
          fontSize: 11,
          fontWeight: 500,
          fontFamily: "var(--font-primary)",
          background: color + "22",
          color,
          border: `1px solid ${color}44`,
          borderRadius: "var(--radius-full)",
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
        {updating ? "..." : issue.state.name}
        <span style={{ fontSize: 9, marginLeft: 2 }}>{open ? "\u25b2" : "\u25bc"}</span>
      </button>
      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 300 }} onClick={() => setOpen(false)} />
          <div style={{
            position: "absolute",
            ...(dropUp ? { bottom: "100%", marginBottom: 4 } : { top: "100%", marginTop: 4 }),
            left: 0,
            background: "var(--bg-surface)",
            border: "1px solid var(--border-default)",
            borderRadius: "var(--radius-md)",
            boxShadow: "var(--elevation-2)",
            zIndex: 301,
            minWidth: 160,
            padding: 4,
            maxHeight: 250,
            overflow: "auto",
          }}>
            {states.map((s) => {
              const sc = stateColors[s.type] ?? "var(--fg-muted)";
              const isCurrent = s.id === issue.state.id;
              return (
                <div
                  key={s.id}
                  className="list-row"
                  onClick={(e) => { e.stopPropagation(); handleSelect(s.id); }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 10px",
                    borderRadius: "var(--radius-sm)",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: isCurrent ? 600 : 400,
                    color: isCurrent ? "var(--fg-default)" : "var(--fg-light)",
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: sc, flexShrink: 0 }} />
                  {s.name}
                  {isCurrent && <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--fg-muted)" }}>current</span>}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function IssueCard({ project, issue, onRefresh, onSessionChange }: {
  project: Project;
  issue: LinearIssue;
  onRefresh: () => void;
  onSessionChange?: () => void;
}) {
  const [starting, setStarting] = useState(false);

  const hasSession = !!issue.session.sessionId;

  const handleChat = async () => {
    if (hasSession) return;
    setStarting(true);
    try {
      await api.chatIssue(project.id, issue.identifier, issue);
      onRefresh();
      onSessionChange?.();
    } catch (err: any) {
      alert(`Failed to start: ${err.message}`);
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    await api.stopIssue(project.id, issue.identifier);
    onRefresh();
    onSessionChange?.();
  };

  return (
    <div style={rowStyle}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--fg-muted)", fontFamily: "monospace", flexShrink: 0, width: 70 }}>{issue.identifier}</span>
        <StatusDropdown project={project} issue={issue} onChanged={onRefresh} />
        <span style={{ fontSize: 13, fontWeight: 500, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{issue.title}</span>
        {issue.session.running && (
          <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: "var(--radius-full)", background: "var(--semantic-success-tint)", color: "var(--semantic-success)", fontWeight: 500 }}>running</span>
        )}
        {issue.assignee && (
          <span style={{ fontSize: 11, color: "var(--fg-muted)", flexShrink: 0 }}>{issue.assignee.name}</span>
        )}
        {issue.labels.nodes.map((l) => (
          <span key={l.name} style={{ fontSize: 10, padding: "1px 6px", borderRadius: "var(--radius-full)", background: l.color + "22", color: l.color, border: `1px solid ${l.color}44`, flexShrink: 0 }}>
            {l.name}
          </span>
        ))}
        <button onClick={handleChat} disabled={starting} style={btnSmallPrimary}>
          {starting ? "..." : "Chat"}
        </button>
        {hasSession && (
          <button onClick={handleStop} style={btnSmallDanger}>Stop</button>
        )}
        <a href={issue.url} target="_blank" rel="noopener noreferrer" style={linearIconLink} title="Open in Linear">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <path d="M3.03509 12.9431C3.24245 14.9227 4.10472 16.8468 5.62188 18.364C7.13904 19.8811 9.0631 20.7434 11.0428 20.9508L3.03509 12.9431Z" />
            <path d="M3 11.4938L12.4921 20.9858C13.2976 20.9407 14.0981 20.7879 14.8704 20.5273L3.4585 9.11548C3.19793 9.88771 3.0451 10.6883 3 11.4938Z" />
            <path d="M3.86722 8.10999L15.8758 20.1186C16.4988 19.8201 17.0946 19.4458 17.6493 18.9956L4.99021 6.33659C4.54006 6.89125 4.16573 7.487 3.86722 8.10999Z" />
            <path d="M5.66301 5.59517C9.18091 2.12137 14.8488 2.135 18.3498 5.63604C21.8508 9.13708 21.8645 14.8049 18.3907 18.3228L5.66301 5.59517Z" />
          </svg>
        </a>
      </div>
  );
}

export default function IssueList({ project, onSessionChange, refreshTrigger }: Props) {
  const [issues, setIssues] = useState<LinearIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    api.getIssues(project.id)
      .then(setIssues)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [project.id]);

  useEffect(() => {
    refresh();
  }, [refresh, refreshTrigger]);

  // SSE: auto-refresh when webhook updates issues
  useEffect(() => {
    const evtSource = new EventSource(
      `/api/projects/${encodeURIComponent(project.id)}/issues/stream`
    );
    evtSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "issues_updated") {
          refresh();
        }
      } catch {}
    };
    return () => evtSource.close();
  }, [project.id, refresh]);

  // Group by state type
  const byState: Record<string, LinearIssue[]> = {};
  for (const issue of issues) {
    const key = issue.state.name;
    if (!byState[key]) byState[key] = [];
    byState[key].push(issue);
  }

  // Order: started states first, then unstarted, then backlog/triage
  const stateOrder = ["started", "unstarted", "triage", "backlog"];
  const sortedGroups = Object.entries(byState).sort(([, a], [, b]) => {
    const aType = a[0]?.state.type ?? "";
    const bType = b[0]?.state.type ?? "";
    return stateOrder.indexOf(aType) - stateOrder.indexOf(bType);
  });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <div style={sectionTitle}>Linear Issues</div>
        <button onClick={refresh} style={refreshBtn} title="Refresh issues">
          {loading ? "..." : "\u21bb"}
        </button>
        <span style={{ fontSize: 12, color: "var(--fg-disabled)" }}>
          {issues.length} active
        </span>
      </div>

      {error && (
        <div style={{ color: "var(--semantic-error)", fontSize: 13, marginBottom: 12 }}>{error}</div>
      )}

      {sortedGroups.map(([stateName, stateIssues]) => (
        <div key={stateName} style={{ marginBottom: 20 }}>
          <div style={groupHeader}>
            <span style={{
              width: 8, height: 8, borderRadius: "50%",
              background: stateColors[stateIssues[0]?.state.type] ?? "var(--fg-muted)",
              display: "inline-block",
            }} />
            {stateName} ({stateIssues.length})
          </div>
          {stateIssues.map((issue) => (
            <IssueCard
              key={issue.id}
              project={project}
              issue={issue}
              onRefresh={refresh}
              onSessionChange={onSessionChange}
            />
          ))}
        </div>
      ))}

      {!loading && issues.length === 0 && !error && (
        <div style={{ color: "var(--fg-muted)", padding: 24, textAlign: "center" }}>
          No active issues found.
        </div>
      )}
    </div>
  );
}

// Styles

const sectionTitle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
};

const refreshBtn: React.CSSProperties = {
  background: "none",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-sm)",
  color: "var(--fg-muted)",
  cursor: "pointer",
  fontSize: 16,
  padding: "2px 8px",
  fontFamily: "var(--font-primary)",
  lineHeight: 1,
};

const groupHeader: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 12,
  fontWeight: 600,
  color: "var(--fg-muted)",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  marginBottom: 10,
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "8px 12px",
  background: "var(--bg-surface)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-sm)",
  marginBottom: 4,
};

const iconBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--fg-muted)",
  cursor: "pointer",
  fontSize: 18,
  padding: 4,
  lineHeight: 1,
};

const btnSmallPrimary: React.CSSProperties = {
  padding: "4px 10px",
  background: "var(--semantic-success)",
  color: "#fff",
  border: "none",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
  fontSize: 12,
  fontFamily: "var(--font-primary)",
};

const btnSmallDanger: React.CSSProperties = {
  padding: "4px 10px",
  background: "var(--semantic-error)",
  color: "#fff",
  border: "none",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
  fontSize: 12,
  fontFamily: "var(--font-primary)",
};

const btnSmallSecondary: React.CSSProperties = {
  padding: "4px 10px",
  background: "var(--bg-elevated)",
  color: "var(--fg-default)",
  border: "none",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
  fontSize: 12,
  fontFamily: "var(--font-primary)",
};

const linearIconLink: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#5E6AD2",
  padding: 4,
  flexShrink: 0,
};
