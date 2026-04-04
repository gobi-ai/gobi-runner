import React, { useState, useEffect, useCallback } from "react";
import { api, type Domain, type Project } from "../api";

interface Props {
  project: Project;
}

function DomainCard({ project, domain, onRefresh }: {
  project: Project;
  domain: Domain;
  onRefresh: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(domain.content);

  // Extract first heading as title
  const titleMatch = domain.content.match(/^#\s+(.+)/m);
  const title = titleMatch ? titleMatch[1] : domain.id;

  // Extract sections for preview
  const sections = domain.content
    .split(/^##\s+/m)
    .slice(1)
    .map((s) => s.split("\n")[0].trim());

  const handleSave = async () => {
    await api.updateDomain(project.id, domain.id, content);
    setEditing(false);
    onRefresh();
  };

  const handleDelete = async () => {
    if (!confirm(`Delete domain "${domain.id}"?`)) return;
    await api.deleteDomain(project.id, domain.id);
    onRefresh();
  };

  if (editing) {
    return (
      <div style={overlay} onMouseDown={() => setEditing(false)}>
        <div style={editorModal} onClick={(e) => e.stopPropagation()}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, flex: 1 }}>{domain.id}.md</h3>
            <button onClick={() => setEditing(false)} style={iconBtn}>&times;</button>
          </div>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            style={textareaStyle}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button onClick={handleDelete} style={btnDanger}>Delete</button>
            <span style={{ flex: 1 }} />
            <button onClick={() => { setContent(domain.content); setEditing(false); }} style={btnSecondary}>Cancel</button>
            <button onClick={handleSave} style={btnPrimary}>Save</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={cardStyle} onClick={() => { setContent(domain.content); setEditing(true); }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>{title}</span>
        <span style={{ fontSize: 11, color: "var(--fg-disabled)", fontFamily: "monospace" }}>{domain.id}.md</span>
      </div>
      {sections.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
          {sections.map((s) => (
            <span key={s} style={tagStyle}>{s}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DomainList({ project }: Props) {
  const [domains, setDomains] = useState<Domain[]>([]);

  const refresh = useCallback(() => {
    api.getDomains(project.id).then(setDomains);
  }, [project.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: "var(--fg-muted)", lineHeight: 1.5 }}>
          Domains define areas of focus for reviewing Pull Requests. Each domain describes a scope, regression checklist, risk areas, and key files to inspect.
        </div>
      </div>

      {/* Domain cards */}
      <div style={cardGrid}>
        {domains.map((domain) => (
          <DomainCard
            key={domain.id}
            project={project}
            domain={domain}
            onRefresh={refresh}
          />
        ))}
      </div>

      {domains.length === 0 && (
        <div style={{ textAlign: "center", color: "var(--fg-muted)", padding: 48 }}>
          No domains found. Add .md files to .runner/domains/
        </div>
      )}
    </div>
  );
}

// Styles

const cardGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
  gap: 12,
};

const cardStyle: React.CSSProperties = {
  background: "var(--bg-surface)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-lg)",
  padding: 16,
  cursor: "pointer",
  transition: "border-color 0.15s",
};

const tagStyle: React.CSSProperties = {
  fontSize: 11,
  padding: "2px 8px",
  borderRadius: "var(--radius-full)",
  background: "var(--bg-elevated)",
  color: "var(--fg-muted)",
};

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0, 0, 0, 0.7)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 100,
};

const editorModal: React.CSSProperties = {
  background: "var(--bg-surface)",
  borderRadius: "var(--radius-lg)",
  border: "1px solid var(--border-default)",
  padding: 24,
  width: "90%",
  maxWidth: 800,
  height: "80vh",
  display: "flex",
  flexDirection: "column",
};

const textareaStyle: React.CSSProperties = {
  flex: 1,
  width: "100%",
  padding: 12,
  background: "var(--bg-base)",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-md)",
  color: "var(--fg-default)",
  fontSize: 13,
  fontFamily: "monospace",
  lineHeight: 1.6,
  resize: "none",
};

const inputStyle: React.CSSProperties = {
  padding: "8px 12px",
  background: "var(--bg-base)",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-sm)",
  color: "var(--fg-default)",
  fontSize: 13,
  fontFamily: "var(--font-primary)",
  marginTop: 4,
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

const btnPrimary: React.CSSProperties = {
  padding: "6px 14px",
  background: "var(--semantic-success)",
  color: "#fff",
  border: "none",
  borderRadius: "var(--radius-md)",
  cursor: "pointer",
  fontSize: 13,
  fontFamily: "var(--font-primary)",
  whiteSpace: "nowrap",
};

const btnSecondary: React.CSSProperties = {
  padding: "6px 14px",
  background: "var(--bg-elevated)",
  color: "var(--fg-default)",
  border: "none",
  borderRadius: "var(--radius-md)",
  cursor: "pointer",
  fontSize: 13,
  fontFamily: "var(--font-primary)",
};

const btnDanger: React.CSSProperties = {
  padding: "6px 14px",
  background: "var(--semantic-error)",
  color: "#fff",
  border: "none",
  borderRadius: "var(--radius-md)",
  cursor: "pointer",
  fontSize: 13,
  fontFamily: "var(--font-primary)",
};
