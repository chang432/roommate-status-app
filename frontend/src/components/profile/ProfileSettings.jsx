import { useState } from "react";
import { useAuth } from "../../context/AuthContext.jsx";
import { cx } from "../../utils/classNames.js";
import SettingsMenu, { SettingsMenuButton } from "../ui/SettingsMenu.jsx";
import SettingsTray from "../ui/SettingsTray.jsx";
import { useConfirmDialog } from "../ui/useConfirmDialog.jsx";
import EnableNotifications from "./EnableNotifications.jsx";
import styles from "./ProfileSettings.module.css";

function ProfileWorkflow({ user, updateProfile, onProfileChanged }) {
  const [name, setName] = useState(user?.name ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    if (!name.trim() || !password || busy) return;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const updated = await updateProfile(name.trim(), password);
      setName(updated.name);
      setPassword("");
      setStatus("Display name updated everywhere.");
      onProfileChanged?.(updated);
    } catch (requestError) {
      setError(requestError.message || "Could not update your display name.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.workflow} aria-labelledby="profile-workflow-heading">
      <div className={styles.sectionHeader}>
        <h3 id="profile-workflow-heading">Profile</h3>
        <p>Your username is permanent; your display name updates across all group history.</p>
      </div>
      {user?.nameSyncPending ? (
        <p className={styles.syncNote}>A previous name change still needs to finish syncing. Save the current name again to retry.</p>
      ) : null}
      <form onSubmit={handleSubmit} className={styles.form}>
        <label>
          <span className="ui-formLabel">Display name</span>
          <input className={cx("ui-textInput", styles.input)} value={name} onChange={(event) => setName(event.target.value)} maxLength={80} />
        </label>
        <label>
          <span className="ui-formLabel">Current password</span>
          <input className={cx("ui-textInput", styles.input)} type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        {error ? <p className="ui-errorBox">{error}</p> : null}
        {status ? <p className={styles.success} role="status">{status}</p> : null}
        <button className={cx("ui-primaryButton", styles.saveButton)} disabled={busy || !name.trim() || !password}>
          {busy ? "Updating…" : "Save profile"}
        </button>
      </form>
    </section>
  );
}

function NotificationsWorkflow() {
  return (
    <section className={styles.workflow} aria-labelledby="notifications-workflow-heading">
      <div className={styles.sectionHeader}>
        <h3 id="notifications-workflow-heading">Notifications</h3>
        <p>Manage push permission for this browser or installed app.</p>
      </div>
      <EnableNotifications />
    </section>
  );
}

function PasswordWorkflow({ updatePassword }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setStatus("");
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await updatePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setStatus("Password updated.");
    } catch (requestError) {
      setError(requestError.message || "Could not update your password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.workflow} aria-labelledby="password-workflow-heading">
      <div className={styles.sectionHeader}>
        <h3 id="password-workflow-heading">Change password</h3>
        <p>Use at least six characters for your new password.</p>
      </div>
      <form onSubmit={handleSubmit} className={styles.form}>
        <label><span className="ui-formLabel">Current password</span><input className={cx("ui-textInput", styles.input)} type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
        <label><span className="ui-formLabel">New password</span><input className={cx("ui-textInput", styles.input)} type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={6} /></label>
        <label><span className="ui-formLabel">Confirm new password</span><input className={cx("ui-textInput", styles.input)} type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={6} /></label>
        {error ? <p className="ui-errorBox">{error}</p> : null}
        {status ? <p className={styles.success} role="status">{status}</p> : null}
        <button className={cx("ui-primaryButton", styles.saveButton)} disabled={busy || !currentPassword || newPassword.length < 6 || !confirmPassword}>
          {busy ? "Updating…" : "Update password"}
        </button>
      </form>
    </section>
  );
}

function DeleteAccountWorkflow({ deleteAccount }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { confirm, confirmationDialog } = useConfirmDialog();

  async function handleSubmit(event) {
    event.preventDefault();
    if (!password || busy) return;
    const accepted = await confirm({
      title: "Delete your account?",
      message: "This permanently removes your account and cannot be undone.",
      confirmLabel: "Delete account",
    });
    if (!accepted) return;
    setBusy(true);
    setError("");
    try {
      await deleteAccount(password);
    } catch (requestError) {
      setError(requestError.message || "Could not delete this account.");
      setBusy(false);
    }
  }

  return (
    <section className={cx(styles.workflow, styles.dangerWorkflow)} aria-labelledby="delete-account-workflow-heading">
      <div className={styles.sectionHeader}>
        <h3 id="delete-account-workflow-heading">Delete account</h3>
        <p>Deleting your account removes memberships and notification subscriptions. This cannot be undone.</p>
      </div>
      <form onSubmit={handleSubmit} className={styles.form}>
        <label><span className="ui-formLabel">Current password</span><input className={cx("ui-textInput", styles.input)} type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {error ? <p className="ui-errorBox">{error}</p> : null}
        <button className={styles.deleteButton} disabled={busy || !password}>{busy ? "Deleting…" : "Delete account"}</button>
      </form>
      {confirmationDialog}
    </section>
  );
}

export default function ProfileSettings({ onClose, widthClassName, onProfileChanged }) {
  const { user, updateProfile, updatePassword, logout, deleteAccount } = useAuth();
  const screens = [
    { id: "profile", title: "Profile", content: <ProfileWorkflow user={user} updateProfile={updateProfile} onProfileChanged={onProfileChanged} /> },
    { id: "notifications", title: "Notifications", content: <NotificationsWorkflow /> },
    { id: "password", title: "Change password", content: <PasswordWorkflow updatePassword={updatePassword} /> },
    { id: "delete", title: "Delete account", content: <DeleteAccountWorkflow deleteAccount={deleteAccount} /> },
  ];

  return (
    <SettingsTray
      title="Profile settings"
      onClose={onClose}
      widthClassName={widthClassName}
      screens={screens}
      renderMenu={(openScreen) => (
        <div className={styles.panel}>
          <section className={styles.identityCard}>
            <div className={styles.avatar} aria-hidden="true">
              {(user?.name || user?.username || "?").slice(0, 1).toUpperCase()}
            </div>
            <div className={styles.identityText}>
              <p className={styles.name}>{user?.name || "Roomie"}</p>
              <p className={styles.username}>@{user?.username || user?.id}</p>
            </div>
          </section>

          <SettingsMenu label="Profile settings options">
            <SettingsMenuButton screenId="profile" title="Profile" description="Update your display name." onClick={(event) => openScreen("profile", event.currentTarget)} />
            <SettingsMenuButton screenId="notifications" title="Notifications" description="Manage push notifications on this device." onClick={(event) => openScreen("notifications", event.currentTarget)} />
            <SettingsMenuButton screenId="password" title="Change password" description="Choose a new account password." onClick={(event) => openScreen("password", event.currentTarget)} />
            <SettingsMenuButton title="Sign out" description="End this session on this device." onClick={logout} disclosure={false} />
            <SettingsMenuButton screenId="delete" title="Delete account" description="Permanently remove your account." onClick={(event) => openScreen("delete", event.currentTarget)} danger />
          </SettingsMenu>
        </div>
      )}
    />
  );
}
