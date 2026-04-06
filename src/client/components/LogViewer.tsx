import React, { useState, useEffect, useRef } from "react";
import { api, type LogEntry } from "../api";

interface Props {
  projectId: string;
  agentId: string;
  /** If provided, show logs for this specific session only */
  sessionId?: string;
  /** Show as a height-limited preview with live updates */
  preview?: boolean;
  /** Called when preview is clicked */
  onClick?: () => void;
}

/** Parse a log message that looks like [tool: Name] details */
function parseToolCall(message: string): { tool: string; detail: string } | null {
  const m = message.match(/^\[tool:\s+([\w\-]+)\]\s*(.*)/);
  if (!m) return null;
  return { tool: m[1], detail: m[2] };
}

/** Shorten MCP tool names: mcp__linear__save_comment → linear/save_comment */
function shortToolName(name: string): string {
  const mcp = name.match(/^mcp__(.+?)__(.+)$/);
  if (mcp) return `${mcp[1].replace(/-server$/, "")}/${mcp[2]}`;
  return name;
}

const toolIcons: Record<string, string> = {
  Bash: "$",
  Read: "\u25b7",
  Write: "\u25b6",
  Edit: "\u270e",
  Glob: "\u2731",
  Grep: "\u2315",
  Agent: "\u2b22",
};

function getToolIcon(name: string): string {
  // Direct match first
  if (toolIcons[name]) return toolIcons[name];
  // MCP tools
  if (name.startsWith("mcp__")) return "\u25c8";
  return "\u25cf";
}

/** Render markdown-ish text: headings, bold, lists */
function renderRichText(text: string): React.ReactNode[] {
  return text.split("\n").map((line, i) => {
    // ## Heading
    const h2 = line.match(/^##\s+(.+)/);
    if (h2) return <div key={i} style={{ fontWeight: 700, fontSize: 14, color: "var(--fg-default)", marginTop: 8, marginBottom: 2 }}>{h2[1]}</div>;

    // # Heading
    const h1 = line.match(/^#\s+(.+)/);
    if (h1) return <div key={i} style={{ fontWeight: 700, fontSize: 15, color: "var(--fg-default)", marginTop: 10, marginBottom: 4 }}>{h1[1]}</div>;

    // - [ ] / - [x] checklist
    const check = line.match(/^(\s*)-\s+\[([ xX])\]\s+(.*)/);
    if (check) {
      const done = check[2] !== " ";
      return (
        <div key={i} style={{ paddingLeft: 12 + (check[1].length * 8), color: done ? "var(--fg-muted)" : "var(--fg-default)" }}>
          <span style={{ marginRight: 6, opacity: 0.6 }}>{done ? "\u2611" : "\u2610"}</span>
          {check[3]}
        </div>
      );
    }

    // - bullet
    const bullet = line.match(/^(\s*)-\s+(.*)/);
    if (bullet) {
      return <div key={i} style={{ paddingLeft: 12 + (bullet[1].length * 8) }}><span style={{ marginRight: 6, color: "var(--fg-muted)" }}>&bull;</span>{renderInline(bullet[2])}</div>;
    }

    // Empty line
    if (line.trim() === "") return <div key={i} style={{ height: 4 }} />;

    // Regular text
    return <div key={i}>{renderInline(line)}</div>;
  });
}

/** Render inline markdown: **bold**, `code` */
function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const re = /(\*\*(.+?)\*\*|`(.+?)`)/g;
  let last = 0;
  let match;
  let key = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[2]) {
      parts.push(<strong key={key++}>{match[2]}</strong>);
    } else if (match[3]) {
      parts.push(<code key={key++} style={{ background: "var(--bg-elevated)", padding: "1px 4px", borderRadius: 3, fontSize: "0.9em" }}>{match[3]}</code>);
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

function LogLine({ entry }: { entry: LogEntry }) {
  const toolCall = entry.type === "output" ? parseToolCall(entry.message) : null;

  if (toolCall) {
    return (
      <div style={lineStyles.toolLine}>
        <span style={lineStyles.toolIcon}>{getToolIcon(toolCall.tool)}</span>
        <span style={lineStyles.toolName}>{shortToolName(toolCall.tool)}</span>
        <span style={lineStyles.toolDetail}>{toolCall.detail}</span>
      </div>
    );
  }

  if (entry.type === "system") {
    const isFinished = entry.message.includes("SESSION FINISHED");
    const isStarting = entry.message.includes("Starting new session") || entry.message.includes("Resuming session") || entry.message.includes("Spawning session");
    const isTrigger = entry.message.includes("triggered");
    const isUserMessage = entry.message.startsWith("You: ");
    if (isUserMessage) {
      return (
        <div style={lineStyles.userMessage}>
          <span style={lineStyles.userLabel}>You</span>
          {entry.message.slice(4)}
        </div>
      );
    }
    return (
      <div style={{
        ...lineStyles.systemLine,
        ...(isFinished ? lineStyles.systemFinished : {}),
        ...(isStarting ? lineStyles.systemStarting : {}),
        ...(isTrigger ? lineStyles.systemTrigger : {}),
      }}>
        {entry.message}
      </div>
    );
  }

  if (entry.type === "error") {
    return (
      <div style={lineStyles.errorLine}>
        {entry.message}
      </div>
    );
  }

  if (entry.type === "info") {
    return (
      <div style={lineStyles.infoLine}>
        {entry.message}
      </div>
    );
  }

  // output (text from assistant) — render markdown-ish content
  const hasMarkdown = /^#{1,3}\s|^\s*-\s|\*\*/.test(entry.message);
  if (hasMarkdown) {
    return (
      <div style={lineStyles.outputLine}>
        {renderRichText(entry.message)}
      </div>
    );
  }

  return (
    <div style={lineStyles.outputLine}>
      {entry.message}
    </div>
  );
}

export default function LogViewer({ projectId, agentId, sessionId, preview, onClick }: Props) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  // Load initial logs
  useEffect(() => {
    api.getLogs(projectId, agentId, 200, sessionId).then(setLogs);
  }, [projectId, agentId, sessionId]);

  // SSE live stream — connect to session-specific stream if sessionId provided
  useEffect(() => {
    let url = `/api/logs/stream?projectId=${encodeURIComponent(projectId)}&agentId=${encodeURIComponent(agentId)}`;
    if (sessionId) {
      url += `&sessionId=${encodeURIComponent(sessionId)}`;
    }
    const evtSource = new EventSource(url);
    evtSource.onmessage = (event) => {
      try {
        const entry = JSON.parse(event.data) as LogEntry;
        if (entry.type === "system" && entry.message === "Connected to log stream") return;
        // New session started — reset logs so we don't mix sessions (only for non-session-specific viewers)
        if (!sessionId && entry.type === "system" && entry.message.startsWith("Starting new session")) {
          setLogs([entry]);
          return;
        }
        setLogs((prev) => [...prev.slice(-500), entry]);
      } catch {}
    };
    return () => evtSource.close();
  }, [projectId, agentId, sessionId]);

  // Auto-scroll
  useEffect(() => {
    if (autoScrollRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 50;
  };

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      onClick={preview ? onClick : undefined}
      style={{
        flex: 1,
        overflow: "auto",
        padding: preview ? "8px 12px" : "16px 20px",
        fontFamily: "monospace",
        fontSize: preview ? 11 : 13,
        lineHeight: preview ? 1.5 : 1.7,
        ...(preview ? {
          background: "var(--bg-base)",
          borderRadius: "var(--radius-sm)",
          maxHeight: 400,
          cursor: onClick ? "pointer" : undefined,
          minHeight: 20,
        } : {}),
      }}
    >
      {logs.length === 0 && (
        <div style={{ color: "var(--fg-disabled)" }}>No logs yet</div>
      )}
      {logs.map((entry, i) => (
        <LogLine key={i} entry={entry} />
      ))}
    </div>
  );
}

const lineStyles = {
  toolLine: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    padding: "2px 0",
    color: "var(--fg-subtle)",
  } as React.CSSProperties,
  toolIcon: {
    color: "var(--semantic-info)",
    fontWeight: 700,
    fontSize: 11,
    width: 14,
    textAlign: "center",
    flexShrink: 0,
  } as React.CSSProperties,
  toolName: {
    color: "var(--semantic-info)",
    fontWeight: 600,
    fontSize: 12,
    flexShrink: 0,
  } as React.CSSProperties,
  toolDetail: {
    color: "var(--fg-muted)",
    fontSize: 12,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } as React.CSSProperties,
  systemLine: {
    padding: "4px 0",
    color: "var(--fg-disabled)",
    fontSize: 11,
    fontStyle: "italic",
  } as React.CSSProperties,
  systemFinished: {
    color: "var(--fg-muted)",
    fontWeight: 600,
    borderTop: "1px solid var(--border-default)",
    marginTop: 8,
    paddingTop: 8,
  } as React.CSSProperties,
  systemStarting: {
    color: "var(--semantic-success)",
    fontWeight: 600,
    borderBottom: "1px solid var(--border-default)",
    marginBottom: 4,
    paddingBottom: 4,
  } as React.CSSProperties,
  systemTrigger: {
    color: "var(--semantic-warning)",
  } as React.CSSProperties,
  errorLine: {
    color: "var(--semantic-error)",
    padding: "2px 0",
  } as React.CSSProperties,
  infoLine: {
    color: "var(--semantic-info)",
    padding: "2px 0",
    fontSize: 12,
  } as React.CSSProperties,
  outputLine: {
    color: "var(--fg-default)",
    padding: "2px 0",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  } as React.CSSProperties,
  userMessage: {
    padding: "8px 12px",
    marginTop: 8,
    marginBottom: 4,
    background: "var(--bg-elevated)",
    borderRadius: 6,
    borderLeft: "3px solid var(--semantic-info)",
    color: "var(--fg-default)",
    fontWeight: 500,
    fontSize: 13,
  } as React.CSSProperties,
  userLabel: {
    color: "var(--semantic-info)",
    fontWeight: 700,
    marginRight: 8,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  } as React.CSSProperties,
};
