import React from "react";

const colors: Record<string, { bg: string; text: string }> = {
  running: { bg: "var(--semantic-success-tint)", text: "var(--semantic-success)" },
  completed: { bg: "var(--semantic-info-tint)", text: "var(--semantic-info)" },
  scheduled: { bg: "var(--semantic-warning-tint)", text: "var(--semantic-warning)" },
  idle: { bg: "var(--bg-elevated)", text: "var(--fg-muted)" },
  disabled: { bg: "var(--bg-base-active)", text: "var(--fg-disabled)" },
  stopped: { bg: "var(--semantic-warning-tint)", text: "var(--semantic-warning)" },
  errored: { bg: "var(--semantic-error-tint)", text: "var(--semantic-error)" },
  skipped: { bg: "var(--bg-elevated)", text: "var(--fg-muted)" },
};

export default function StatusBadge({ status, enabled }: { status: string; enabled: boolean }) {
  const displayStatus = !enabled ? "disabled" : status;
  const color = colors[displayStatus] || colors.idle;

  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: "var(--radius-full)",
        fontSize: 12,
        fontWeight: 500,
        backgroundColor: color.bg,
        color: color.text,
      }}
    >
      {displayStatus}
    </span>
  );
}
