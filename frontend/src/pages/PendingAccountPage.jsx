import { Navigate } from "react-router-dom";
import { useState } from "react";
import Brandmark from "../components/Brandmark.jsx";
import ModalShell from "../components/ModalShell.jsx";
import ProfileSettings from "../components/ProfileSettings.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { cx } from "../utils/classNames.js";
import styles from "./PendingAccountPage.module.css";

export default function PendingAccountPage() {
  const { user, logout, deleteAccount } = useAuth();
  const [settingsOpen, setSettingsOpen] = useState(false);

  if (user?.hasGroup) return <Navigate to="/" replace />;

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
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className={cx("ui-primaryButton", styles.settingsButton)}
        >
          Open profile settings
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
