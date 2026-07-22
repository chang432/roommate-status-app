import { Navigate, useNavigate } from "react-router-dom";
import { useState } from "react";
import Brandmark from "../components/ui/Brandmark.jsx";
import ModalShell from "../components/ui/ModalShell.jsx";
import ProfileSettings from "../components/profile/ProfileSettings.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { cx } from "../utils/classNames.js";
import styles from "./PendingAccountPage.module.css";

export default function PendingAccountPage() {
  const { user, joinGroup, logout, deleteAccount } = useAuth();
  const navigate = useNavigate();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (user?.hasGroup) return <Navigate to="/" replace />;

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await joinGroup(code);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err.message || "Could not join that group.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <Brandmark className={styles.brandmark} />
        <p className={cx("ui-sectionLabel", styles.eyebrow)}>
          Join a household
        </p>
        <h1 className={styles.title}>You are not in a group yet.</h1>
        <p className={styles.copy}>
          Enter your household code to unlock roommate features for{" "}
          {user?.name || "this account"}.
        </p>
        <div className={styles.identity}>
          <span>Signed in as</span>
          <strong>@{user?.username || user?.id}</strong>
        </div>
        <form onSubmit={handleSubmit} className={styles.form}>
          <label htmlFor="group-code" className={cx("ui-formLabel", styles.formLabel)}>
            Group code
          </label>
          <input
            id="group-code"
            type="text"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="YORKSHIRE"
            className={cx("ui-textInput", styles.codeInput)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck="false"
          />
          {error && <p className={cx("ui-errorBox", styles.error)}>{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className={cx("ui-primaryButton", styles.joinButton)}
          >
            {submitting ? "Joining…" : "Join group"}
          </button>
        </form>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className={styles.settingsButton}
        >
          Profile settings
        </button>
        {settingsOpen && (
          <ModalShell
            title="Profile settings"
            onClose={() => setSettingsOpen(false)}
            widthClassName={styles.settingsModal}
          >
            <ProfileSettings
              user={user}
              onSignOut={logout}
              onDeleteAccount={deleteAccount}
            />
          </ModalShell>
        )}
      </section>
    </main>
  );
}
