import { Navigate } from "react-router-dom";
import { useState } from "react";
import Brandmark from "../components/Brandmark.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { cx } from "../utils/classNames.js";
import styles from "./PendingAccountPage.module.css";

export default function PendingAccountPage() {
  const { user, logout, deleteAccount } = useAuth();
  const [error, setError] = useState("");

  if (user?.hasGroup) return <Navigate to="/" replace />;

  async function handleDeleteAccount() {
    const password = window.prompt("Enter your password to delete this account.");
    if (!password) return;
    if (!window.confirm("Delete this account? This cannot be undone.")) return;
    try {
      setError("");
      await deleteAccount(password);
    } catch (err) {
      setError(err.message || "Could not delete this account.");
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <Brandmark className={styles.brandmark} />
        <p className={cx("ui-sectionLabel", styles.eyebrow)}>
          Account created
        </p>
        <h1 className={styles.title}>You are not in a group yet.</h1>
        <p className={styles.copy}>
          {user?.name || "This account"} can sign in, but household features
          stay locked until group joining is added.
        </p>
        <div className={styles.identity}>
          <span>Signed in as</span>
          <strong>@{user?.username || user?.id}</strong>
        </div>
        {error && <p className={cx("ui-errorBox", styles.error)}>{error}</p>}
        <div className={styles.actions}>
          <button type="button" onClick={logout} className="ui-primaryButton">
            Sign out
          </button>
          <button
            type="button"
            onClick={handleDeleteAccount}
            className={styles.deleteButton}
          >
            Delete account
          </button>
        </div>
      </section>
    </main>
  );
}
