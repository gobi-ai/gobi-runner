import React, { useState, useEffect } from "react";
import { api, type Project } from "./api";
import AgentList from "./components/AgentList";
import DomainList from "./components/DomainList";

type Tab = "agents" | "domains";
type AuthState = "checking" | "authenticated" | "login";

function LoginScreen() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        window.location.reload();
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    }
  };

  return (
    <div style={loginStyles.container}>
      <div style={loginStyles.card}>
        <h1 style={loginStyles.title}>Agent Runner</h1>
        {error && <div style={loginStyles.error}>Wrong password</div>}
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(false); }}
            placeholder="Password"
            autoFocus
            style={loginStyles.input}
          />
          <button type="submit" style={loginStyles.button}>Log in</button>
        </form>
      </div>
    </div>
  );
}

export default function App() {
  const [auth, setAuth] = useState<AuthState>("checking");
  const [projects, setProjects] = useState<Project[]>([]);
  const [tab, setTab] = useState<Tab>("agents");

  useEffect(() => {
    api.getProjects()
      .then((p) => {
        setProjects(p);
        setAuth("authenticated");
      })
      .catch((err) => {
        if (err.message.includes("401") || err.message === "Unauthorized") {
          setAuth("login");
        } else {
          // Not an auth error — might be no password set, or network issue
          setAuth("authenticated");
        }
      });
  }, []);

  if (auth === "checking") {
    return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "var(--fg-muted)" }}>Loading...</div>;
  }

  if (auth === "login") {
    return <LoginScreen />;
  }

  const project = projects[0] ?? null;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.logo}>Agent Runner</span>
        {project && (
          <span style={styles.projectName}>{project.name}</span>
        )}
        <div style={styles.tabs}>
          {(["agents", "domains"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={tab === t ? styles.tabActive : styles.tab}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div style={styles.main}>
        {project ? (
          tab === "agents" ? (
            <AgentList project={project} />
          ) : (
            <DomainList project={project} />
          )
        ) : (
          <div style={{ padding: 32, color: "var(--fg-muted)" }}>
            No projects configured.
          </div>
        )}
      </div>
    </div>
  );
}

const loginStyles = {
  container: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100vh",
  } as React.CSSProperties,
  card: {
    background: "var(--bg-surface)",
    border: "1px solid var(--border-default)",
    borderRadius: "var(--radius-lg)",
    padding: 32,
    width: 340,
  } as React.CSSProperties,
  title: {
    fontSize: 18,
    fontWeight: 600,
    marginBottom: 20,
  } as React.CSSProperties,
  error: {
    color: "var(--semantic-error)",
    fontSize: 13,
    marginBottom: 8,
  } as React.CSSProperties,
  input: {
    width: "100%",
    padding: "10px 12px",
    background: "var(--bg-base)",
    border: "1px solid var(--border-strong)",
    borderRadius: "var(--radius-sm)",
    color: "var(--fg-default)",
    fontSize: 14,
    marginBottom: 12,
    fontFamily: "var(--font-primary)",
  } as React.CSSProperties,
  button: {
    width: "100%",
    padding: 10,
    background: "var(--semantic-success)",
    color: "#fff",
    border: "none",
    borderRadius: "var(--radius-md)",
    cursor: "pointer",
    fontSize: 14,
    fontFamily: "var(--font-primary)",
    fontWeight: 500,
  } as React.CSSProperties,
};

const styles = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
  } as React.CSSProperties,
  header: {
    padding: "12px 24px",
    borderBottom: "1px solid var(--border-default)",
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexShrink: 0,
  } as React.CSSProperties,
  logo: {
    fontSize: 16,
    fontWeight: 700,
  } as React.CSSProperties,
  projectName: {
    fontSize: 13,
    color: "var(--fg-muted)",
  } as React.CSSProperties,
  tabs: {
    display: "flex",
    gap: 4,
    marginLeft: "auto",
  } as React.CSSProperties,
  tab: {
    padding: "6px 14px",
    background: "none",
    border: "none",
    borderRadius: "var(--radius-md)",
    color: "var(--fg-muted)",
    cursor: "pointer",
    fontSize: 13,
    fontFamily: "var(--font-primary)",
    fontWeight: 500,
  } as React.CSSProperties,
  tabActive: {
    padding: "6px 14px",
    background: "var(--bg-elevated)",
    border: "none",
    borderRadius: "var(--radius-md)",
    color: "var(--fg-default)",
    cursor: "pointer",
    fontSize: 13,
    fontFamily: "var(--font-primary)",
    fontWeight: 600,
  } as React.CSSProperties,
  main: {
    flex: 1,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  } as React.CSSProperties,
};
