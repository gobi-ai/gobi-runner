import React, { useState } from "react";
import { api, type Project } from "../api";

interface Props {
  projects: Project[];
  selected: Project | null;
  onSelect: (p: Project) => void;
  onRefresh: () => void;
}

export default function ProjectList({ projects, selected, onSelect, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [targetDir, setTargetDir] = useState("");

  const handleCreate = async () => {
    if (!id || !name || !targetDir) return;
    await api.createProject({ id, name, targetDir });
    setShowForm(false);
    setId("");
    setName("");
    setTargetDir("");
    onRefresh();
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: "var(--fg-muted)", textTransform: "uppercase", letterSpacing: 1, fontWeight: 500 }}>Projects</span>
        <button
          onClick={() => setShowForm(!showForm)}
          style={{ background: "none", border: "none", color: "var(--semantic-info)", cursor: "pointer", fontSize: 18 }}
        >
          +
        </button>
      </div>
      {showForm && (
        <div style={{ marginBottom: 12, padding: 8, background: "var(--bg-elevated)", borderRadius: "var(--radius-md)" }}>
          <input placeholder="ID" value={id} onChange={(e) => setId(e.target.value)}
            style={inputStyle} />
          <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)}
            style={inputStyle} />
          <input placeholder="Target directory" value={targetDir} onChange={(e) => setTargetDir(e.target.value)}
            style={inputStyle} />
          <button onClick={handleCreate} style={btnStyle}>Add</button>
        </div>
      )}
      {projects.map((p) => (
        <div
          key={p.id}
          onClick={() => onSelect(p)}
          style={{
            padding: "8px 12px",
            borderRadius: "var(--radius-md)",
            cursor: "pointer",
            marginBottom: 2,
            background: selected?.id === p.id ? "var(--semantic-info-tint)" : "transparent",
            color: selected?.id === p.id ? "var(--semantic-info)" : "var(--fg-default)",
          }}
        >
          {p.name}
          <div style={{ fontSize: 11, color: "var(--fg-muted)", marginTop: 2 }}>{p.targetDir}</div>
        </div>
      ))}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "4px 8px",
  marginBottom: 4,
  background: "var(--bg-base)",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-sm)",
  color: "var(--fg-default)",
  fontSize: 13,
  fontFamily: "var(--font-primary)",
};

const btnStyle: React.CSSProperties = {
  padding: "4px 12px",
  background: "var(--semantic-success)",
  color: "#fff",
  border: "none",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
  fontSize: 13,
  fontFamily: "var(--font-primary)",
};
