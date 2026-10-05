"use client";

import { Suspense, useState, FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get("from") || "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Login failed");
        setLoading(false);
        return;
      }

      // Redirect to the originally requested page
      router.push(from);
      router.refresh();
    } catch {
      setError("Network error — please try again");
      setLoading(false);
    }
  }

  return (
    <div style={styles.wrapper}>
      <div style={styles.card}>
        {/* Logo / Brand */}
        <div style={styles.brand}>
          <div style={styles.logoCircle}>BE</div>
          <h1 style={styles.title}>Bansil Engineers</h1>
          <p style={styles.subtitle}>Analytics &amp; Reconciliation</p>
        </div>

        {/* Login Form */}
        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.field}>
            <label htmlFor="email" style={styles.label}>
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={styles.input}
              placeholder="you@example.com"
            />
          </div>

          <div style={styles.field}>
            <label htmlFor="password" style={styles.label}>
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={styles.input}
              placeholder="Enter password"
            />
          </div>

          {error && <div style={styles.error}>{error}</div>}

          <button
            type="submit"
            disabled={loading}
            style={{
              ...styles.button,
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>

        <p style={styles.footer}>
          Authorized personnel only. Contact admin for access.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div style={styles.wrapper}>
          <div style={styles.card}>
            <div style={styles.brand}>
              <div style={styles.logoCircle}>BE</div>
              <h1 style={styles.title}>Bansil Engineers</h1>
              <p style={styles.subtitle}>Loading…</p>
            </div>
          </div>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    minHeight: "100vh",
    flex: 1,
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "linear-gradient(135deg, #f6f7fb 0%, #e8eaed 100%)",
    padding: "16px",
  },
  card: {
    width: "100%",
    maxWidth: "400px",
    background: "#ffffff",
    borderRadius: "12px",
    boxShadow:
      "0 4px 24px rgba(60, 64, 67, 0.12), 0 1px 3px rgba(60, 64, 67, 0.08)",
    padding: "40px 36px 32px",
  },
  brand: {
    textAlign: "center" as const,
    marginBottom: "32px",
  },
  logoCircle: {
    width: "56px",
    height: "56px",
    borderRadius: "50%",
    background: "linear-gradient(135deg, #1a73e8, #174ea6)",
    color: "#fff",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "20px",
    fontWeight: 700,
    marginBottom: "16px",
    letterSpacing: "1px",
  },
  title: {
    fontSize: "20px",
    fontWeight: 600,
    color: "#263044",
    margin: 0,
  },
  subtitle: {
    fontSize: "13px",
    color: "#66738a",
    marginTop: "4px",
  },
  form: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "20px",
  },
  field: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "6px",
  },
  label: {
    fontSize: "13px",
    fontWeight: 500,
    color: "#263044",
  },
  input: {
    padding: "10px 14px",
    border: "1px solid #dce2ec",
    borderRadius: "8px",
    fontSize: "14px",
    color: "#263044",
    outline: "none",
    transition: "border-color 0.15s",
  },
  error: {
    padding: "10px 14px",
    background: "#fce8e6",
    border: "1px solid #d93025",
    borderRadius: "8px",
    color: "#d93025",
    fontSize: "13px",
  },
  button: {
    padding: "12px",
    background: "linear-gradient(135deg, #1a73e8, #174ea6)",
    color: "#ffffff",
    border: "none",
    borderRadius: "8px",
    fontSize: "15px",
    fontWeight: 600,
    cursor: "pointer",
    marginTop: "4px",
  },
  footer: {
    textAlign: "center" as const,
    fontSize: "11px",
    color: "#80868b",
    marginTop: "24px",
  },
};
