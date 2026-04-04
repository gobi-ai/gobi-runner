import React, { useState, useEffect, useCallback } from "react";
import cronstrue from "cronstrue";
import { api, type Agent, type AgentState, type AgentTrigger, type CronTrigger, type IssueSession, type LinearIssue, type LinearWebhookTrigger, type Project } from "../api";
import LogViewer from "./LogViewer";
import IssueList from "./IssueList";

const LINEAR_STATUSES = [
  "Created", "Planned", "Approved", "AskUserQuestion",
  "ReviewNeeded", "Rejected", "HumanReview", "Done", "Cancelled",
];

interface Props {
  project: Project;
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
  const [form, setForm] = useState({
    name: agent.name,
    model: agent.model,
    permissionMode: agent.permissionMode,
    prompt: agent.prompt,
  });
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
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
          <label style={labelStyle}>
            Name
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={inputStyle} />
          </label>
          <label style={labelStyle}>
            Model
            <select value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} style={inputStyle}>
              <option value="">Default</option>
              <option value="sonnet">Sonnet</option>
              <option value="opus">Opus</option>
              <option value="haiku">Haiku</option>
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
  const [activeRunningTab, setActiveRunningTab] = useState<string | null>(null);
  const [fullscreenLogAgent, setFullscreenLogAgent] = useState<string | null>(null);
  const [runningLayout, setRunningLayout] = useState<"tabs" | "1" | "2" | "3" | "4">(() =>
    (localStorage.getItem("runner_layout") as any) || "tabs"
  );
  const [dismissedInstances, setDismissedInstances] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(`dismissed_${project.id}`);
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });
  const [issueChatInput, setIssueChatInput] = useState<Record<string, string>>({});
  const [issueChatSending, setIssueChatSending] = useState<Set<string>>(new Set());
  const [issueRefreshTrigger, setIssueRefreshTrigger] = useState(0);

  // Persist dismissed set to localStorage
  useEffect(() => {
    localStorage.setItem(`dismissed_${project.id}`, JSON.stringify([...dismissedInstances]));
  }, [dismissedInstances, project.id]);

  const refresh = useCallback(() => {
    api.getAgents(project.id).then((agents) => {
      setAgents(agents);
      const runningIds = agents.filter((a) => a.state.status === "running").map((a) => a.id);
      if (runningIds.length > 0) {
        setDismissedInstances((prev) => {
          const hasAny = runningIds.some((id) => prev.has(id));
          if (!hasAny) return prev;
          const next = new Set(prev);
          runningIds.forEach((id) => next.delete(id));
          return next;
        });
      }
    });
    api.getIssueSessions(project.id).then(setIssueSessions).catch(() => {});
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

  // SSE for state changes
  useEffect(() => {
    const evtSource = new EventSource(
      `/api/projects/${encodeURIComponent(project.id)}/agents/stream`
    );
    evtSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.agentId && data.state) {
          // Un-dismiss when a new session starts
          if (data.state.status === "running") {
            setDismissedInstances((prev) => {
              if (!prev.has(data.agentId)) return prev;
              const next = new Set(prev);
              next.delete(data.agentId);
              return next;
            });
          }
          setAgents((prev) =>
            prev.map((a) =>
              a.id === data.agentId ? { ...a, state: data.state as AgentState } : a
            )
          );
        }
      } catch {}
    };
    return () => evtSource.close();
  }, [project.id]);

  const dismissInstance = (agentId: string) => {
    setDismissedInstances((prev) => new Set(prev).add(agentId));
  };


  // Unified instances: agent runs + issue chat sessions
  type Instance =
    | { kind: "agent"; id: string; name: string; status: string }
    | { kind: "issue"; id: string; name: string; identifier: string; busy: boolean };

  const agentInst: Instance[] = agents
    .filter((a) => a.state.status !== "idle" && !dismissedInstances.has(a.id))
    .map((a) => ({ kind: "agent" as const, id: a.id, name: a.name, status: a.state.status }));

  const issueInst: Instance[] = issueSessions
    .filter((s) => !dismissedInstances.has(s.agentId))
    .map((s) => ({ kind: "issue" as const, id: s.agentId, name: s.identifier, identifier: s.identifier, busy: s.busy }));

  const instances: Instance[] = [...issueInst, ...agentInst];
  const enabled = agents.filter((a) => a.enabled);
  const disabled = agents.filter((a) => !a.enabled);

  return (
    <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
      {/* Instances */}
      {instances.length > 0 && (() => {
        const selectedId = activeRunningTab && instances.find((a) => a.id === activeRunningTab)
          ? activeRunningTab
          : instances[0].id;
        const selected = instances.find((a) => a.id === selectedId)!;

        const isAlive = (inst: Instance) => inst.kind === "agent" ? inst.status === "running" : true;

        const layoutOptions: { value: typeof runningLayout; label: string }[] = [
          { value: "tabs", label: "Tabs" },
          { value: "1", label: "1 col" },
          { value: "2", label: "2 col" },
          { value: "3", label: "3 col" },
          { value: "4", label: "4 col" },
        ];

        const stopInstance = async (inst: Instance) => {
          if (inst.kind === "agent") {
            await api.stopAgent(project.id, inst.id);
          } else {
            await api.stopIssue(project.id, inst.identifier);
            setIssueRefreshTrigger((n) => n + 1);
          }
          refresh();
        };

        const renderChatInput = (inst: Instance) => {
          if (inst.kind !== "issue") return null;
          return (
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <input
                type="text"
                value={issueChatInput[inst.identifier] || ""}
                onChange={(e) => setIssueChatInput((prev) => ({ ...prev, [inst.identifier]: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendIssueChat(inst.identifier)}
                placeholder={issueChatSending.has(inst.identifier) ? "Sending..." : "Type a message..."}
                disabled={issueChatSending.has(inst.identifier)}
                style={{ flex: 1, padding: "6px 10px", background: "var(--bg-base)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)", color: "var(--fg-default)", fontSize: 13, fontFamily: "var(--font-primary)" }}
              />
              <button onClick={() => sendIssueChat(inst.identifier)} disabled={issueChatSending.has(inst.identifier)} style={btnSmallPrimary}>Send</button>
            </div>
          );
        };

        return (
          <>
            <div style={{ ...sectionHeader, marginBottom: 12 }}>
              <span style={sectionDot("#00AC47")} />
              Instances ({instances.length})
              <select
                value={runningLayout}
                onChange={(e) => { const v = e.target.value as typeof runningLayout; setRunningLayout(v); localStorage.setItem("runner_layout", v); }}
                style={layoutSelect}
              >
                {layoutOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            {runningLayout === "tabs" ? (
              <div style={runningPanel}>
                <div style={tabBar}>
                  {instances.map((inst) => {
                    const isActive = inst.id === selectedId;
                    const alive = isAlive(inst);
                    return (
                      <div key={inst.id} style={{ display: "flex", alignItems: "center", borderBottom: isActive ? "2px solid var(--semantic-success)" : "2px solid transparent" }}>
                        <button
                          onClick={() => setActiveRunningTab(inst.id)}
                          style={isActive ? tabActive : tabStyle}
                        >
                          <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: alive ? "#00AC47" : "#7D7A75", marginRight: 6 }} />
                          {inst.name}
                        </button>
                        {!alive && (
                          <button onClick={() => dismissInstance(inst.id)} style={{ ...iconBtn, fontSize: 14, padding: "4px 2px" }} title="Dismiss">&times;</button>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div style={tabContent}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>{selected.name}</span>
                    <span style={{ fontSize: 11, color: "var(--fg-muted)" }}>({selected.kind === "agent" ? selected.status : "chat"})</span>
                    {isAlive(selected) ? (
                      <button onClick={() => stopInstance(selected)} style={btnSmallDanger}>Stop</button>
                    ) : (
                      <button onClick={() => dismissInstance(selected.id)} style={btnSmallSecondary}>Dismiss</button>
                    )}
                    <button onClick={() => setFullscreenLogAgent(selected.id)} style={btnSmallSecondary}>Expand</button>
                  </div>
                  <LogViewer
                    projectId={project.id}
                    agentId={selected.id}
                    preview
                  />
                  {renderChatInput(selected)}
                </div>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${runningLayout}, minmax(0, 1fr))`, gap: 12, marginBottom: 24 }}>
                {instances.map((inst) => {
                  const alive = isAlive(inst);
                  return (
                    <div key={inst.id} style={{ ...cardStyle, display: "flex", flexDirection: "column" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                        <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: alive ? "#00AC47" : "#7D7A75" }} />
                        <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>{inst.name}</span>
                        <span style={{ fontSize: 11, color: "var(--fg-muted)" }}>({inst.kind === "agent" ? inst.status : "chat"})</span>
                        {alive ? (
                          <button onClick={() => stopInstance(inst)} style={btnSmallDanger}>Stop</button>
                        ) : (
                          <button onClick={() => dismissInstance(inst.id)} style={{ ...iconBtn, fontSize: 16 }} title="Dismiss">&times;</button>
                        )}
                        <button onClick={() => setFullscreenLogAgent(inst.id)} style={btnSmallSecondary}>Expand</button>
                      </div>
                      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
                        <LogViewer
                          projectId={project.id}
                          agentId={inst.id}
                          preview
                        />
                        {renderChatInput(inst)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        );
      })()}

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
                <button onClick={() => setFullscreenLogAgent(agent.id)} style={iconBtn} title="Logs">
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
                <button onClick={() => setFullscreenLogAgent(agent.id)} style={iconBtn} title="Logs">
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
      {fullscreenLogAgent && (() => {
        const agent = agents.find((a) => a.id === fullscreenLogAgent);
        if (!agent) return null;
        return (
          <div style={overlay} onMouseDown={() => setFullscreenLogAgent(null)}>
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
                {agent.state.status !== "idle" && agent.state.status !== "running" && (
                  <span style={lastExecStyle}>({agent.state.status})</span>
                )}
                <button onClick={() => setFullscreenLogAgent(null)} style={iconBtn}>&times;</button>
              </div>
              <LogViewer projectId={project.id} agentId={agent.id} />
            </div>
          </div>
        );
      })()}

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

const runningPanel: React.CSSProperties = {
  background: "var(--bg-surface)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-lg)",
  overflow: "hidden",
  marginBottom: 24,
};

const tabBar: React.CSSProperties = {
  display: "flex",
  borderBottom: "1px solid var(--border-default)",
  background: "var(--bg-base)",
  overflow: "auto",
};

const layoutSelect: React.CSSProperties = {
  marginLeft: "auto",
  padding: "2px 8px",
  background: "var(--bg-base)",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-sm)",
  color: "var(--fg-default)",
  fontSize: 12,
  fontFamily: "var(--font-primary)",
  cursor: "pointer",
  textTransform: "none" as const,
  letterSpacing: 0,
  fontWeight: 400,
};

const tabStyle: React.CSSProperties = {
  padding: "8px 16px",
  background: "none",
  border: "none",
  color: "var(--fg-muted)",
  cursor: "pointer",
  fontSize: 13,
  fontFamily: "var(--font-primary)",
  fontWeight: 500,
  whiteSpace: "nowrap",
};

const tabActive: React.CSSProperties = {
  ...tabStyle,
  color: "var(--fg-default)",
  fontWeight: 600,
};

const tabContent: React.CSSProperties = {
  padding: 16,
};

const cardGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, 1fr)",
  gap: 12,
  marginBottom: 24,
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
