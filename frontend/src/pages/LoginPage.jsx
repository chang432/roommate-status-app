import { useState } from "react";
import { Link, useLocation, useNavigate, Navigate } from "react-router-dom";
import Brandmark from "../components/ui/Brandmark.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { cx } from "../utils/classNames.js";
import styles from "./LoginPage.module.css";

export default function LoginPage() {
  const { user, login } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const returnTo = location.state?.returnTo || "/";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Already signed in? Skip the login screen.
  if (user) return <Navigate to={user.hasGroup ? returnTo : "/pending"} replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const signedIn = await login(username, password);
      navigate(signedIn.hasGroup ? returnTo : "/pending", { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
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
          Welcome home — sign in with your username.
        </p>

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
            autoComplete="current-password"
          />
        </div>

        {error && <p className={cx("ui-errorBox", styles.error)}>{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className={cx("ui-primaryButton", styles.submit)}
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>

        <p className={styles.authLink}>
          New here? <Link to="/signup">Create an account</Link>
        </p>

        <p className={styles.footer}>Seeded roommates use their lowercase name and password roomie.</p>
      </form>
    </main>
  );
}
