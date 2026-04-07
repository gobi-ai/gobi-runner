import React, { useState, useEffect, useCallback } from "react";
import cronstrue from "cronstrue";
import { api, type Agent, type AgentState, type AgentTrigger, type CronTrigger, type ExecutionRecord, type IssueSession, type LinearIssue, type LinearWebhookTrigger, type Project, type ProviderInfo, type QueueItem } from "../api";
import LogViewer from "./LogViewer";
import IssueList from "./IssueList";

const LINEAR_STATUSES = [
  "Created", "Planned", "Approved", "AskUserQuestion",
  "ReviewNeeded", "Rejected", "HumanReview", "Done", "Cancelled",
];

interface Props {
  project: Project;
}

function formatTimeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function describeCron(expr: string): string {
  try {
    return cronstrue.toString(expr);
  } catch {
    return expr;
  }
}

function EditModal({ project, agent, onClose, onSaved }: {
  project: Project;
  agent: Agent;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [selectedProvider, setSelectedProvider] = useState(agent.provider ?? "claude");
  const [form, setForm] = useState({
    name: agent.name,
    model: agent.model,
    permissionMode: agent.permissionMode,
    prompt: agent.prompt,
  });

  useEffect(() => {
    api.getProviders().then(setProviders).catch(() => {});
  }, []);
  const [triggers, setTriggers] = useState<AgentTrigger[]>(() => {
    const existing = agent.triggers ?? [];
    // Migrate legacy schedule field into a cron trigger if no cron triggers exist
    if (agent.schedule && !existing.some((t) => t.type === "cron")) {
      return [{ type: "cron" as const, schedule: agent.schedule }, ...existing];
    }
    return existing;
  });

  const addCronTrigger = () => {
    setTriggers([...triggers, { type: "cron", schedule: "0 * * * *" }]);
  };

  const addWebhookTrigger = () => {
    setTriggers([...triggers, { type: "linear-webhook", statusTo: [], teams: [], labels: [] }]);
  };

  const removeTrigger = (index: number) => {
    setTriggers(triggers.filter((_, i) => i !== index));
  };

  const toggleTriggerStatus = (index: number, status: string) => {
    setTriggers(triggers.map((t, i) => {
      if (i !== index || t.type !== "linear-webhook") return t;
      const current = t.statusTo ?? [];
      return { ...t, statusTo: current.includes(status) ? current.filter((s: string) => s !== status) : [...current, status] };
    }));
  };

  const updateCronSchedule = (index: number, value: string) => {
    setTriggers(triggers.map((t, i) =>
      i === index && t.type === "cron" ? { ...t, schedule: value } : t
    ));
  };

  const updateTriggerTeams = (index: number, value: string) => {
    setTriggers(triggers.map((t, i) =>
      i === index ? { ...t, teams: value.split(",").map((s) => s.trim()).filter(Boolean) } : t
    ));
  };

  const updateTriggerLabels = (index: number, value: string) => {
    setTriggers(triggers.map((t, i) =>
      i === index ? { ...t, labels: value.split(",").map((s) => s.trim()).filter(Boolean) } : t
    ));
  };

  const handleSave = async () => {
    await api.updateAgent(project.id, agent.id, {
      ...form,
      provider: selectedProvider,
      triggers,
      enabled: agent.enabled,
    });
    onSaved();
    onClose();
  };

  const handleDelete = async () => {
    if (!confirm("Delete this agent?")) return;
    await api.deleteAgent(project.id, agent.id);
    onSaved();
    onClose();
  };

  return (
    <div style={overlay} onMouseDown={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600 }}>Edit {agent.name}</h3>
          <button onClick={onClose} style={iconBtn}>&times;</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
          <label style={labelStyle}>
            Name
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={inputStyle} />
          </label>
          <label style={labelStyle}>
            Provider
            <select value={selectedProvider} onChange={(e) => { setSelectedProvider(e.target.value); setForm({ ...form, model: "" }); }} style={inputStyle}>
              {providers.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
            </select>
          </label>
          <label style={labelStyle}>
            Model
            <select value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} style={inputStyle}>
              {(providers.find((p) => p.id === selectedProvider)?.models ?? []).map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </label>
          <label style={labelStyle}>
            Permission Mode
            <input value={form.permissionMode} onChange={(e) => setForm({ ...form, permissionMode: e.target.value })} style={inputStyle} />
          </label>
        </div>

        {/* Triggers */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: "var(--fg-muted)" }}>Triggers</span>
            <div style={{ display: "flex", gap: 4 }}>
              <button onClick={addCronTrigger} type="button" style={{ ...btnSmallSecondary, fontSize: 11 }}>+ Cron</button>
              <button onClick={addWebhookTrigger} type="button" style={{ ...btnSmallSecondary, fontSize: 11 }}>+ Webhook</button>
            </div>
          </div>
          {triggers.map((trigger, i) => (
            <div key={i} style={{ background: "var(--bg-base)", border: "1px solid var(--border-default)", borderRadius: "var(--radius-sm)", padding: 10, marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--fg-muted)", textTransform: "uppercase" }}>
                  {trigger.type === "cron" ? "Cron Schedule" : "Linear Webhook"}
                </span>
                <button onClick={() => removeTrigger(i)} type="button" style={{ ...iconBtn, fontSize: 14 }}>&times;</button>
              </div>
              {trigger.type === "cron" ? (
                <label style={labelStyle}>
                  Schedule
                  <input
                    value={trigger.schedule}
                    onChange={(e) => updateCronSchedule(i, e.target.value)}
                    placeholder="e.g. 0 * * * *"
                    style={inputStyle}
                  />
                  <span style={{ fontSize: 10, color: "var(--fg-muted)", marginTop: 2, display: "block" }}>
                    {describeCron(trigger.schedule)}
                  </span>
                </label>
              ) : (
                <>
                  <div style={{ marginBottom: 8 }}>
                    <span style={{ fontSize: 11, color: "var(--fg-muted)", display: "block", marginBottom: 4 }}>Status To</span>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {LINEAR_STATUSES.map((status) => {
                        const selected = ((trigger as LinearWebhookTrigger).statusTo ?? []).includes(status);
                        return (
                          <button
                            key={status}
                            type="button"
                            onClick={() => toggleTriggerStatus(i, status)}
                            style={{
                              padding: "3px 10px",
                              fontSize: 11,
                              borderRadius: "var(--radius-sm)",
                              border: selected ? "1px solid var(--semantic-success)" : "1px solid var(--border-strong)",
                              background: selected ? "var(--semantic-success)" : "var(--bg-base)",
                              color: selected ? "#fff" : "var(--fg-default)",
                              cursor: "pointer",
                              fontFamily: "var(--font-primary)",
                            }}
                          >
                            {status}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <label style={labelStyle}>
                      Teams
                      <input
                        value={((trigger as LinearWebhookTrigger).teams ?? []).join(", ")}
                        onChange={(e) => updateTriggerTeams(i, e.target.value)}
                        placeholder="e.g. ENG, PLATFORM"
                        style={inputStyle}
                      />
                    </label>
                    <label style={labelStyle}>
                      Labels
                      <input
                        value={((trigger as LinearWebhookTrigger).labels ?? []).join(", ")}
                        onChange={(e) => updateTriggerLabels(i, e.target.value)}
                        placeholder="e.g. bug, feature"
                        style={inputStyle}
                      />
                    </label>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        <label style={labelStyle}>
          Prompt
          <textarea
            value={form.prompt}
            onChange={(e) => setForm({ ...form, prompt: e.target.value })}
            style={{ ...inputStyle, height: 200, resize: "vertical", fontFamily: "monospace", fontSize: 12 }}
          />
        </label>
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button onClick={handleDelete} style={btnDanger}>Delete</button>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} style={btnSecondary}>Cancel</button>
          <button onClick={handleSave} style={btnPrimary}>Save</button>
        </div>
      </div>
    </div>
  );
}

function TriggerBadges({ agent }: { agent: Agent }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--fg-muted)", flexWrap: "wrap" }}>
      {agent.triggers?.filter((t) => t.type === "cron").map((t, i) => (
        <span key={`cron-${i}`} style={{ background: "var(--bg-elevated)", padding: "1px 6px", borderRadius: "var(--radius-sm)", fontSize: 11 }}>
          {describeCron((t as CronTrigger).schedule)}
        </span>
      ))}
      {agent.schedule && !agent.triggers?.some((t) => t.type === "cron") && (
        <span style={{ background: "var(--bg-elevated)", padding: "1px 6px", borderRadius: "var(--radius-sm)", fontSize: 11 }}>
          {describeCron(agent.schedule)}
        </span>
      )}
      {agent.triggers?.filter((t) => t.type === "linear-webhook").map((t, i) => (
        <span key={`wh-${i}`} style={{ background: "var(--bg-elevated)", padding: "1px 6px", borderRadius: "var(--radius-sm)", fontSize: 11 }}>
          webhook: {((t as LinearWebhookTrigger).statusTo ?? []).join(", ") || "any"}
        </span>
      ))}
      {agent.provider && agent.provider !== "claude" && <span>{agent.provider}</span>}
      {agent.model && <span>{agent.model}</span>}
      {agent.state.totalCostUsd > 0 && (
        <span>${agent.state.totalCostUsd.toFixed(4)}</span>
      )}
    </div>
  );
}

function AgentCard({ project, agent, onEdit, onRefresh }: {
  project: Project;
  agent: Agent;
  onEdit: () => void;
  onRefresh: () => void;
}) {
  const [showLogs, setShowLogs] = useState(false);
  const isRunning = agent.state.status === "running";

  const toggleEnabled = async () => {
    if (agent.enabled) {
      await api.disableAgent(project.id, agent.id);
    } else {
      await api.enableAgent(project.id, agent.id);
    }
    onRefresh();
  };

  const trigger = async () => {
    await api.triggerAgent(project.id, agent.id);
    onRefresh();
  };

  const stop = async () => {
    await api.stopAgent(project.id, agent.id);
    onRefresh();
  };

  return (
    <>
      <div style={cardStyle}>
        {/* Header row */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{agent.name}</span>
          {!isRunning && agent.state.status !== "idle" && (
            <span style={lastExecStyle}>({agent.state.status})</span>
          )}
          <span style={{ flex: 1 }} />
          <button onClick={() => setShowLogs(true)} style={iconBtn} title="Logs">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
          </button>
          <button onClick={onEdit} style={iconBtn} title="Edit agent">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
        </div>

        {/* Meta row */}
        <div style={{ marginBottom: 10 }}>
          <TriggerBadges agent={agent} />
        </div>

        {/* Log preview for running agents */}
        {isRunning && (
          <div style={{ marginBottom: 10 }}>
            <LogViewer
              projectId={project.id}
              agentId={agent.id}
              preview
              onClick={() => setShowLogs(true)}
            />
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={toggleEnabled} style={btnSmallDanger}>Disable</button>
          {isRunning ? (
            <button onClick={stop} style={btnSmallDanger}>Stop</button>
          ) : (
            <button onClick={trigger} style={btnSmallPrimary}>Run Now</button>
          )}
        </div>
      </div>

      {/* Fullscreen log overlay */}
      {showLogs && (
        <div style={overlay} onMouseDown={() => setShowLogs(false)}>
          <div style={logModal} onClick={(e) => e.stopPropagation()}>
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 20px",
              borderBottom: "1px solid var(--border-default)",
              flexShrink: 0,
            }}>
              <span style={{ fontWeight: 600, fontSize: 15, flex: 1 }}>
                {agent.name}
              </span>
              {agent.state.status !== "idle" && (
                <span style={lastExecStyle}>({agent.state.status})</span>
              )}
              <button onClick={() => setShowLogs(false)} style={iconBtn}>&times;</button>
            </div>
            <LogViewer projectId={project.id} agentId={agent.id} />
          </div>
        </div>
      )}
    </>
  );
}

function IdleAgentRow({ project, agent, onEdit, onRefresh }: {
  project: Project;
  agent: Agent;
  onEdit: () => void;
  onRefresh: () => void;
}) {
  const [showLogs, setShowLogs] = useState(false);

  const disable = async () => {
    await api.disableAgent(project.id, agent.id);
    onRefresh();
  };

  const trigger = async () => {
    await api.triggerAgent(project.id, agent.id);
    onRefresh();
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "var(--bg-surface)", border: "1px solid var(--border-default)", borderRadius: "var(--radius-sm)", marginBottom: 4 }}>
        <span style={{ fontWeight: 500, fontSize: 13, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{agent.name}</span>
        {agent.state.status !== "idle" && agent.state.status !== "running" && (
          <span style={lastExecStyle}>({agent.state.status})</span>
        )}
        <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
          <TriggerBadges agent={agent} />
        </div>
        <button onClick={() => setShowLogs(true)} style={iconBtn} title="Logs">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
        </button>
        <button onClick={onEdit} style={iconBtn} title="Edit">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button onClick={trigger} style={btnSmallPrimary}>Run Now</button>
        <button onClick={disable} style={btnSmallDanger}>Disable</button>
      </div>

      {showLogs && (
        <div style={overlay} onMouseDown={() => setShowLogs(false)}>
          <div style={logModal} onClick={(e) => e.stopPropagation()}>
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 20px",
              borderBottom: "1px solid var(--border-default)",
              flexShrink: 0,
            }}>
              <span style={{ fontWeight: 600, fontSize: 15, flex: 1 }}>{agent.name}</span>
              <button onClick={() => setShowLogs(false)} style={iconBtn}>&times;</button>
            </div>
            <LogViewer projectId={project.id} agentId={agent.id} />
          </div>
        </div>
      )}
    </>
  );
}

function DisabledAgentRow({ project, agent, onEdit, onRefresh }: {
  project: Project;
  agent: Agent;
  onEdit: () => void;
  onRefresh: () => void;
}) {
  const [showLogs, setShowLogs] = useState(false);

  const enable = async () => {
    await api.enableAgent(project.id, agent.id);
    onRefresh();
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "var(--bg-surface)", border: "1px solid var(--border-default)", borderRadius: "var(--radius-sm)", marginBottom: 4 }}>
        <span style={{ fontWeight: 500, fontSize: 13, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{agent.name}</span>
        <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
          <TriggerBadges agent={agent} />
        </div>
        <button onClick={() => setShowLogs(true)} style={iconBtn} title="Logs">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
        </button>
        <button onClick={onEdit} style={iconBtn} title="Edit">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button onClick={enable} style={btnSmallInfo}>Enable</button>
      </div>

      {showLogs && (
        <div style={overlay} onMouseDown={() => setShowLogs(false)}>
          <div style={logModal} onClick={(e) => e.stopPropagation()}>
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 20px",
              borderBottom: "1px solid var(--border-default)",
              flexShrink: 0,
            }}>
              <span style={{ fontWeight: 600, fontSize: 15, flex: 1 }}>{agent.name}</span>
              <button onClick={() => setShowLogs(false)} style={iconBtn}>&times;</button>
            </div>
            <LogViewer projectId={project.id} agentId={agent.id} />
          </div>
        </div>
      )}
    </>
  );
}

function IssuePicker({ project, agentId, onClose, onRefresh }: {
  project: Project;
  agentId: string;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [issues, setIssues] = useState<LinearIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState("");
  const [triggering, setTriggering] = useState(false);

  useEffect(() => {
    api.getIssues(project.id).then(setIssues).finally(() => setLoading(false));
  }, [project.id]);

  const handleRun = async () => {
    const issue = issues.find((i) => i.identifier === selected);
    if (!issue) return;
    setTriggering(true);
    try {
      await api.triggerAgent(project.id, agentId, issue);
      onRefresh();
      onClose();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setTriggering(false);
    }
  };

  return (
    <div style={overlay} onMouseDown={onClose}>
      <div style={{ ...modal, maxHeight: "80vh" }} onMouseDown={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, flex: 1 }}>Run agent against issue</h3>
          <button onClick={onClose} style={iconBtn}>&times;</button>
        </div>
        {loading ? (
          <div style={{ color: "var(--fg-muted)" }}>Loading issues...</div>
        ) : (
          <div style={{ overflow: "auto", flex: 1, marginBottom: 16 }}>
            {issues.map((issue) => (
              <div
                key={issue.id}
                className="list-row"
                onClick={() => setSelected(issue.identifier)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 12px",
                  borderRadius: "var(--radius-sm)",
                  cursor: "pointer",
                  marginBottom: 2,
                  background: selected === issue.identifier ? "var(--semantic-info-tint)" : "transparent",
                  border: selected === issue.identifier ? "1px solid var(--semantic-info)" : "1px solid transparent",
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--fg-muted)", fontFamily: "monospace", width: 70, flexShrink: 0 }}>
                  {issue.identifier}
                </span>
                <span style={{ fontSize: 13, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {issue.title}
                </span>
                <span style={{ fontSize: 11, color: "var(--fg-muted)" }}>{issue.state.name}</span>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={btnSecondary}>Cancel</button>
          <button onClick={handleRun} disabled={!selected || triggering} style={btnPrimary}>
            {triggering ? "Starting..." : "Run"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AgentList({ project }: Props) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [issueSessions, setIssueSessions] = useState<IssueSession[]>([]);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [issuePickerAgent, setIssuePickerAgent] = useState<string | null>(null);
  const [fullscreenLog, setFullscreenLog] = useState<{ agentId: string; sessionId?: string; label: string } | null>(null);
  // Selected item in the sidebar: instance or execution history entry
  const [selectedPanel, setSelectedPanel] = useState<{
    kind: "instance"; id: string; agentId: string; sessionId?: string; label: string; issueIdentifier?: string;
  } | {
    kind: "execution"; agentId: string; sessionId: string; label: string;
  } | null>(null);
  const [executions, setExecutions] = useState<ExecutionRecord[]>([]);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [issueChatInput, setIssueChatInput] = useState<Record<string, string>>({});
  const [issueChatSending, setIssueChatSending] = useState<Set<string>>(new Set());
  const [issueRefreshTrigger, setIssueRefreshTrigger] = useState(0);

  const refresh = useCallback(() => {
    api.getAgents(project.id).then(setAgents);
    api.getIssueSessions(project.id).then(setIssueSessions).catch(() => {});
    api.getExecutions(project.id).then(setExecutions).catch(() => {});
    api.getQueue(project.id).then(setQueueItems).catch(() => {});
  }, [project.id]);

  const sendIssueChat = async (identifier: string) => {
    const msg = (issueChatInput[identifier] || "").trim();
    if (!msg) return;
    setIssueChatInput((prev) => ({ ...prev, [identifier]: "" }));
    setIssueChatSending((prev) => new Set(prev).add(identifier));
    try {
      await api.sendIssueMessage(project.id, identifier, msg);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIssueChatSending((prev) => { const next = new Set(prev); next.delete(identifier); return next; });
    }
  };

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Fallback poll: catch state changes if SSE misses them
  useEffect(() => {
    const interval = setInterval(refresh, 10_000);
    return () => clearInterval(interval);
  }, [refresh]);

  // SSE for state changes
  useEffect(() => {
    const evtSource = new EventSource(
      `/api/projects/${encodeURIComponent(project.id)}/agents/stream`
    );
    evtSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.agentId && data.state) {
          setAgents((prev) =>
            prev.map((a) =>
              a.id === data.agentId ? { ...a, state: data.state as AgentState } : a
            )
          );
          // Refresh execution history when a session finishes
          if (data.state.status !== "running" && data.state.status !== "idle") {
            api.getExecutions(project.id).then(setExecutions).catch(() => {});
          }
        }
      } catch {}
    };
    return () => evtSource.close();
  }, [project.id]);

  // Unified instances: agent runs (one per active session) + issue chat sessions
  type Instance =
    | { kind: "agent"; id: string; agentId: string; sessionId?: string; name: string; hashSuffix?: string; status: string; linearIdentifier?: string; startedAt?: string }
    | { kind: "issue"; id: string; agentId: string; name: string; identifier: string; busy: boolean };

  const agentInst: Instance[] = [];
  for (const a of agents) {
    if (a.state.status !== "running") continue;
    const sessions = a.state.activeSessions || [];
    for (const s of sessions) {
      agentInst.push({
        kind: "agent" as const,
        id: `${a.id}:${s.sessionId}`,
        agentId: a.id,
        sessionId: s.sessionId,
        name: a.name,
        hashSuffix: s.sessionId.slice(0, 6),
        status: a.state.status,
        linearIdentifier: s.linearIdentifier,
        startedAt: s.startedAt,
      });
    }
    if (sessions.length === 0) {
      agentInst.push({
        kind: "agent" as const,
        id: a.id,
        agentId: a.id,
        name: a.name,
        status: a.state.status,
      });
    }
  }

  const issueInst: Instance[] = issueSessions
    .map((s) => ({ kind: "issue" as const, id: s.agentId, agentId: s.agentId, name: s.identifier, identifier: s.identifier, busy: s.busy }));

  // Sort running instances by start time, newest first
  agentInst.sort((a, b) => {
    const ta = a.kind === "agent" && a.startedAt ? new Date(a.startedAt).getTime() : 0;
    const tb = b.kind === "agent" && b.startedAt ? new Date(b.startedAt).getTime() : 0;
    return tb - ta;
  });
  const instances: Instance[] = [...issueInst, ...agentInst];
  const enabled = agents.filter((a) => a.enabled);
  const disabled = agents.filter((a) => !a.enabled);

  // Auto-select first running instance if nothing selected
  const autoSelected = selectedPanel
    || (instances.length > 0
      ? { kind: "instance" as const, id: instances[0].id, agentId: instances[0].agentId, sessionId: instances[0].kind === "agent" ? instances[0].sessionId : undefined, label: instances[0].name, issueIdentifier: instances[0].kind === "issue" ? instances[0].identifier : undefined }
      : null);

  const stopInstance = async (inst: Instance) => {
    if (inst.kind === "agent") {
      await api.stopAgent(project.id, inst.agentId);
    } else {
      await api.stopIssue(project.id, inst.identifier);
      setIssueRefreshTrigger((n) => n + 1);
    }
    refresh();
  };

  const hasSidebarContent = instances.length > 0 || queueItems.length > 0 || executions.length > 0;

  return (
    <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
      {/* Two-panel: sidebar (instances + history) | log viewer */}
      {hasSidebarContent && (
        <div style={{ display: "flex", gap: 16, marginBottom: 24, minHeight: 400, maxHeight: "calc(100vh - 200px)" }}>
          {/* Left sidebar */}
          <div style={{ width: 280, flexShrink: 0, display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg-surface)", border: "1px solid var(--border-default)", borderRadius: "var(--radius-lg)" }}>
            <div style={{ flex: 1, overflow: "auto", padding: 8 }}>
              {/* Running Instances */}
              {instances.length > 0 && (
                <>
                  <div style={{ ...sidebarSectionLabel, marginTop: 4 }}>
                    <span style={sectionDot("#00AC47")} />
                    Running ({instances.length})
                  </div>
                  {instances.map((inst) => {
                    const isSelected = autoSelected?.kind === "instance" && autoSelected.id === inst.id;
                    return (
                      <div
                        key={inst.id}
                        onClick={() => setSelectedPanel({ kind: "instance", id: inst.id, agentId: inst.agentId, sessionId: inst.kind === "agent" ? inst.sessionId : undefined, label: inst.name, issueIdentifier: inst.kind === "issue" ? inst.identifier : undefined })}
                        style={{
                          ...sidebarRow,
                          background: isSelected ? "var(--semantic-info-tint)" : "transparent",
                          border: isSelected ? "1px solid var(--semantic-info)" : "1px solid transparent",
                        }}
                      >
                        <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#00AC47", flexShrink: 0, marginTop: 4 }} />
                        <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                          <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {inst.name}{inst.kind === "agent" && inst.hashSuffix && <span style={{ color: "var(--fg-muted)", fontWeight: 400 }}> #{inst.hashSuffix}</span>}
                          </div>
                          {inst.kind === "agent" && (inst.linearIdentifier || inst.startedAt) && (
                            <div style={{ fontSize: 11, color: "var(--fg-muted)", display: "flex", gap: 6 }}>
                              {inst.linearIdentifier && (
                                <span style={{ fontWeight: 600, color: "var(--semantic-info)", fontFamily: "monospace" }}>{inst.linearIdentifier}</span>
                              )}
                              {inst.startedAt && <span>{formatTimeAgo(inst.startedAt)}</span>}
                            </div>
                          )}
                          {inst.kind === "issue" && (
                            <div style={{ fontSize: 11, color: "var(--fg-muted)" }}>chat</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </>
              )}

              {/* Queued */}
              {queueItems.length > 0 && (
                <>
                  <div style={{ ...sidebarSectionLabel, marginTop: instances.length > 0 ? 12 : 4 }}>
                    <span style={sectionDot("#F59E0B")} />
                    Queued ({queueItems.length})
                  </div>
                  {queueItems.map((item, i) => (
                    <div
                      key={`${item.issueId}:${item.agentId}`}
                      style={{
                        ...sidebarRow,
                        opacity: 0.8,
                        border: "1px solid transparent",
                      }}
                    >
                      <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#F59E0B", flexShrink: 0, marginTop: 4 }} />
                      <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                        <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {item.agentName}
                        </div>
                        {item.linearIdentifier && (
                          <div style={{ fontSize: 11, color: "var(--fg-muted)", display: "flex", gap: 6 }}>
                            <span style={{ fontWeight: 600, color: "var(--semantic-info)", fontFamily: "monospace" }}>{item.linearIdentifier}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </>
              )}

              {/* Execution History */}
              {executions.length > 0 && (
                <>
                  <div style={{ ...sidebarSectionLabel, marginTop: instances.length > 0 || queueItems.length > 0 ? 12 : 4 }}>
                    <span style={sectionDot("#7D7A75")} />
                    History ({executions.length})
                  </div>
                  {executions.map((exec) => {
                    const isSelected = autoSelected?.kind === "execution" && autoSelected.sessionId === exec.sessionId;
                    const statusColor = exec.status === "completed" ? "#00AC47" : exec.status === "errored" ? "var(--semantic-error)" : "var(--fg-muted)";
                    return (
                      <div
                        key={exec.sessionId}
                        onClick={() => setSelectedPanel({ kind: "execution", agentId: exec.agentId, sessionId: exec.sessionId, label: `${exec.agentName}${exec.linearIdentifier ? ` — ${exec.linearIdentifier}` : ""}` })}
                        style={{
                          ...sidebarRow,
                          background: isSelected ? "var(--semantic-info-tint)" : "transparent",
                          border: isSelected ? "1px solid var(--semantic-info)" : "1px solid transparent",
                        }}
                      >
                        <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: statusColor, flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                          <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {exec.agentName} <span style={{ color: "var(--fg-muted)", fontWeight: 400 }}>#{exec.sessionId.slice(0, 6)}</span>
                          </div>
                          <div style={{ fontSize: 11, color: "var(--fg-muted)", display: "flex", gap: 6 }}>
                            {exec.linearIdentifier && (
                              <span style={{ fontWeight: 600, color: "var(--semantic-info)", fontFamily: "monospace" }}>{exec.linearIdentifier}</span>
                            )}
                            <span>{formatTimeAgo(exec.startedAt)}</span>
                            {exec.costUsd != null && exec.costUsd > 0 && (
                              <span>${exec.costUsd.toFixed(4)}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </div>

          {/* Right panel: log viewer */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, background: "var(--bg-surface)", border: "1px solid var(--border-default)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
            {autoSelected ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderBottom: "1px solid var(--border-default)", flexShrink: 0 }}>
                  <span style={{ fontWeight: 600, fontSize: 14, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{autoSelected.label}</span>
                  {autoSelected.kind === "instance" && (
                    <>
                      <button onClick={() => {
                        const inst = instances.find((i) => i.id === autoSelected.id);
                        if (inst) stopInstance(inst);
                      }} style={btnSmallDanger}>Stop</button>
                    </>
                  )}
                  <button onClick={() => setFullscreenLog({ agentId: autoSelected.agentId, sessionId: autoSelected.kind === "instance" ? autoSelected.sessionId : autoSelected.sessionId, label: autoSelected.label })} style={btnSmallSecondary}>Expand</button>
                </div>
                {/* Issue chat input */}
                {autoSelected.kind === "instance" && autoSelected.issueIdentifier && (
                  <div style={{ display: "flex", gap: 8, padding: "8px 16px", borderBottom: "1px solid var(--border-default)" }}>
                    <input
                      type="text"
                      value={issueChatInput[autoSelected.issueIdentifier] || ""}
                      onChange={(e) => setIssueChatInput((prev) => ({ ...prev, [autoSelected.issueIdentifier!]: e.target.value }))}
                      onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendIssueChat(autoSelected.issueIdentifier!)}
                      placeholder={issueChatSending.has(autoSelected.issueIdentifier) ? "Sending..." : "Type a message..."}
                      disabled={issueChatSending.has(autoSelected.issueIdentifier)}
                      style={{ flex: 1, padding: "6px 10px", background: "var(--bg-base)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)", color: "var(--fg-default)", fontSize: 13, fontFamily: "var(--font-primary)" }}
                    />
                    <button onClick={() => sendIssueChat(autoSelected.issueIdentifier!)} disabled={issueChatSending.has(autoSelected.issueIdentifier)} style={btnSmallPrimary}>Send</button>
                  </div>
                )}
                <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
                  <LogViewer
                    projectId={project.id}
                    agentId={autoSelected.agentId}
                    sessionId={autoSelected.kind === "instance" ? autoSelected.sessionId : autoSelected.sessionId}
                  />
                </div>
              </>
            ) : (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--fg-muted)", fontSize: 13 }}>
                Select an instance or execution to view logs
              </div>
            )}
          </div>
        </div>
      )}

      {/* Enabled Agents */}
      {enabled.length > 0 && (
        <>
          <div style={sectionHeader}>
            <span style={sectionDot("#00AC47")} />
            Enabled ({enabled.length})
          </div>
          <div style={{ marginBottom: 24 }}>
            {enabled.map((agent) => (
              <div key={agent.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "var(--bg-surface)", border: "1px solid var(--border-default)", borderRadius: "var(--radius-sm)", marginBottom: 4 }}>
                <span style={{ fontWeight: 500, fontSize: 13, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{agent.name}</span>
                <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                  <TriggerBadges agent={agent} />
                </div>
                <button onClick={() => setFullscreenLog({ agentId: agent.id, label: agent.name })} style={iconBtn} title="Logs">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="16" y1="13" x2="8" y2="13"/>
                    <line x1="16" y1="17" x2="8" y2="17"/>
                  </svg>
                </button>
                <button onClick={() => setEditingAgent(agent)} style={iconBtn} title="Edit">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </button>
                <button onClick={() => setIssuePickerAgent(agent.id)} style={btnSmallPrimary}>Run Now</button>
                <button onClick={async () => { await api.disableAgent(project.id, agent.id); refresh(); }} style={btnSmallDanger}>Disable</button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Disabled Agents */}
      {disabled.length > 0 && (
        <>
          <div style={sectionHeader}>
            <span style={sectionDot("#555")} />
            Disabled ({disabled.length})
          </div>
          <div style={{ marginBottom: 24 }}>
            {disabled.map((agent) => (
              <div key={agent.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "var(--bg-surface)", border: "1px solid var(--border-default)", borderRadius: "var(--radius-sm)", marginBottom: 4 }}>
                <span style={{ fontWeight: 500, fontSize: 13, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{agent.name}</span>
                <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                  <TriggerBadges agent={agent} />
                </div>
                <button onClick={() => setFullscreenLog({ agentId: agent.id, label: agent.name })} style={iconBtn} title="Logs">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="16" y1="13" x2="8" y2="13"/>
                    <line x1="16" y1="17" x2="8" y2="17"/>
                  </svg>
                </button>
                <button onClick={() => setEditingAgent(agent)} style={iconBtn} title="Edit">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </button>
                <button onClick={async () => { await api.enableAgent(project.id, agent.id); refresh(); }} style={btnSmallInfo}>Enable</button>
              </div>
            ))}
          </div>
        </>
      )}


      {/* Linear Issues */}
      <div style={{ marginTop: 32, borderTop: "1px solid var(--border-default)", paddingTop: 24 }}>
        <IssueList project={project} onSessionChange={refresh} refreshTrigger={issueRefreshTrigger} />
      </div>

      {/* Fullscreen log overlay */}
      {fullscreenLog && (
        <div style={overlay} onMouseDown={() => setFullscreenLog(null)}>
          <div style={logModal} onClick={(e) => e.stopPropagation()}>
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 20px",
              borderBottom: "1px solid var(--border-default)",
              flexShrink: 0,
            }}>
              <span style={{ fontWeight: 600, fontSize: 15, flex: 1 }}>{fullscreenLog.label}</span>
              <button onClick={() => setFullscreenLog(null)} style={iconBtn}>&times;</button>
            </div>
            <LogViewer projectId={project.id} agentId={fullscreenLog.agentId} sessionId={fullscreenLog.sessionId} />
          </div>
        </div>
      )}

      {/* Issue picker for Run Now */}
      {issuePickerAgent && (
        <IssuePicker
          project={project}
          agentId={issuePickerAgent}
          onClose={() => setIssuePickerAgent(null)}
          onRefresh={refresh}
        />
      )}

      {/* Edit modal */}
      {editingAgent && (
        <EditModal
          project={project}
          agent={editingAgent}
          onClose={() => setEditingAgent(null)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}

// Styles

const lastExecStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--fg-muted)",
  fontStyle: "italic",
  fontWeight: 400,
};

const sidebarRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 10px",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
  marginBottom: 2,
};

const sidebarSectionLabel: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 11,
  fontWeight: 600,
  color: "var(--fg-muted)",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  padding: "4px 10px",
  marginBottom: 4,
};

const cardStyle: React.CSSProperties = {
  background: "var(--bg-surface)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-lg)",
  padding: 16,
};

const sectionHeader: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 13,
  fontWeight: 600,
  color: "var(--fg-muted)",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  marginBottom: 12,
};

function sectionDot(color: string): React.CSSProperties {
  return {
    display: "inline-block",
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: color,
  };
}

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0, 0, 0, 0.7)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 100,
};

const modal: React.CSSProperties = {
  background: "var(--bg-surface)",
  borderRadius: "var(--radius-lg)",
  border: "1px solid var(--border-default)",
  padding: 24,
  width: "90%",
  maxHeight: "90vh",
  overflow: "auto",
};

const logModal: React.CSSProperties = {
  background: "var(--bg-base)",
  borderRadius: "var(--radius-lg)",
  border: "1px solid var(--border-default)",
  width: "calc(100% - 48px)",
  height: "calc(100% - 48px)",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  boxShadow: "0 8px 32px rgba(0, 0, 0, 0.5)",
};

const iconBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--fg-muted)",
  cursor: "pointer",
  fontSize: 18,
  padding: 4,
  lineHeight: 1,
  borderRadius: "var(--radius-sm)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 10px",
  background: "var(--bg-base)",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-sm)",
  color: "var(--fg-default)",
  fontSize: 13,
  marginTop: 4,
  fontFamily: "var(--font-primary)",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  color: "var(--fg-muted)",
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

const btnSmallInfo: React.CSSProperties = {
  padding: "4px 10px",
  background: "var(--semantic-info)",
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
