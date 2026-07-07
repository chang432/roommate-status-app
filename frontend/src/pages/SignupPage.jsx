import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import Brandmark from "../components/Brandmark.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { cx } from "../utils/classNames.js";
import styles from "./LoginPage.module.css";

export default function SignupPage() {
  const { user, createAccount } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to={user.hasGroup ? "/" : "/pending"} replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      if (password !== confirmPassword) {
        throw new Error("Passwords do not match.");
      }
      const signedIn = await createAccount(username, name, password);
      navigate(signedIn.hasGroup ? "/" : "/pending", { replace: true });
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
          Create
          <br />
          your account
        </h1>
        <p className={styles.subtitle}>
          Account access starts here. Join your household with a group code after signup.
        </p>

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
            placeholder="Create a password"
            className={cx("ui-textInput", styles.textInput)}
            autoComplete="new-password"
          />
        </div>

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

        {error && <p className={cx("ui-errorBox", styles.error)}>{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className={cx("ui-primaryButton", styles.submit)}
        >
          {submitting ? "Creating…" : "Create account"}
        </button>

        <p className={styles.authLink}>
          Already have an account? <Link to="/login">Sign in</Link>
        </p>

        <p className={styles.footer}>New accounts land on the join screen until they enter a valid group code.</p>
      </form>
    </main>
  );
}
