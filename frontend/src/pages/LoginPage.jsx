import { useEffect, useState } from "react";
import { useLocation, useNavigate, Navigate } from "react-router-dom";
import Brandmark from "../components/Brandmark.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { cx } from "../utils/classNames.js";
import styles from "./LoginPage.module.css";

export default function LoginPage() {
  const { user, login, createAccount } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const returnTo = location.state?.returnTo || "/";

  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setError("");
  }, [mode]);

  // Already signed in? Skip the login screen.
  if (user) return <Navigate to={user.hasGroup ? returnTo : "/pending"} replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const signedIn = mode === "login"
        ? await login(username, password)
        : await handleCreateAccount();
      navigate(signedIn.hasGroup ? returnTo : "/pending", { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateAccount() {
    if (password !== confirmPassword) {
      throw new Error("Passwords do not match.");
    }
    return createAccount(username, name, password);
  }

  return (
    <main className={styles.page}>
      <form onSubmit={handleSubmit} className={styles.form}>
        <Brandmark className={styles.brandmark} />

        <h1 className={styles.title}>
          Yorkshire
          <br />
          Roomie Status
        </h1>
        <p className={styles.subtitle}>
          {mode === "login"
            ? "Welcome home — sign in with your username."
            : "Create an account now. Group joining comes later."}
        </p>

        <div className={styles.modeSwitch} role="tablist" aria-label="Account mode">
          <button
            type="button"
            className={cx(styles.modeButton, mode === "login" && styles.modeButtonActive)}
            onClick={() => setMode("login")}
          >
            Sign in
          </button>
          <button
            type="button"
            className={cx(styles.modeButton, mode === "create" && styles.modeButtonActive)}
            onClick={() => setMode("create")}
          >
            Create account
          </button>
        </div>

        {mode === "create" && (
          <div className={styles.field}>
            <label htmlFor="name" className="ui-formLabel">
              Display name
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="What should roommates call you?"
              className={cx("ui-textInput", styles.textInput)}
              autoComplete="name"
            />
          </div>
        )}

        <div className={styles.field}>
          <label htmlFor="username" className="ui-formLabel">
            Username
          </label>
          <input
            id="username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="andre"
            className={cx("ui-textInput", styles.textInput)}
            autoComplete="username"
          />
        </div>

        <div className={styles.passwordField}>
          <label htmlFor="password" className="ui-formLabel">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            className={cx("ui-textInput", styles.textInput)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />
        </div>

        {mode === "create" && (
          <div className={styles.passwordField}>
            <label htmlFor="confirmPassword" className="ui-formLabel">
              Confirm password
            </label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter your password"
              className={cx("ui-textInput", styles.textInput)}
              autoComplete="new-password"
            />
          </div>
        )}

        {error && <p className={cx("ui-errorBox", styles.error)}>{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className={cx("ui-primaryButton", styles.submit)}
        >
          {submitting
            ? (mode === "login" ? "Signing in…" : "Creating…")
            : (mode === "login" ? "Sign in" : "Create account")}
        </button>

        <p className={styles.footer}>
          {mode === "login"
            ? "Seeded roommates use their lowercase name and password roomie."
            : "New accounts wait here until group joining is available."}
        </p>
      </form>
    </main>
  );
}
