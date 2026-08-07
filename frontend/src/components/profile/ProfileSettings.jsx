import { useState } from "react";
import { useAuth } from "../../context/AuthContext.jsx";
import { cx } from "../../utils/classNames.js";
import EnableNotifications from "./EnableNotifications.jsx";
import { useConfirmDialog } from "../ui/useConfirmDialog.jsx";
import styles from "./ProfileSettings.module.css";

export default function ProfileSettings({ onProfileChanged }) {
  const { user, updateProfile, updatePassword, logout, deleteAccount } = useAuth();
  const [name, setName] = useState(user?.name ?? "");
  const [namePassword, setNamePassword] = useState("");
  const [nameBusy, setNameBusy] = useState(false);
  const [nameStatus, setNameStatus] = useState("");
  const [nameError, setNameError] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordStatus, setPasswordStatus] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const { confirm, confirmationDialog } = useConfirmDialog();

  async function handleNameSave(event) {
    event.preventDefault();
    if (!name.trim() || !namePassword || nameBusy) return;
    setNameBusy(true);
    setNameError("");
    setNameStatus("");
    try {
      const updated = await updateProfile(name.trim(), namePassword);
      setName(updated.name);
      setNamePassword("");
      setNameStatus("Display name updated everywhere.");
      onProfileChanged?.(updated);
    } catch (error) {
      setNameError(error.message || "Could not update your display name.");
    } finally {
      setNameBusy(false);
    }
  }

  async function handlePasswordSave(event) {
    event.preventDefault();
    setPasswordError("");
    setPasswordStatus("");
    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords do not match.");
      return;
    }
    setPasswordBusy(true);
    try {
      await updatePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordStatus("Password updated.");
    } catch (error) {
      setPasswordError(error.message || "Could not update your password.");
    } finally {
      setPasswordBusy(false);
    }
  }

  async function handleDeleteAccount(event) {
    event.preventDefault();
    if (!deletePassword || deleteBusy) return;
    const accepted = await confirm({
      title: "Delete your account?",
      message: "This permanently removes your account and cannot be undone.",
      confirmLabel: "Delete account",
    });
    if (!accepted) return;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      await deleteAccount(deletePassword);
    } catch (error) {
      setDeleteError(error.message || "Could not delete this account.");
      setDeleteBusy(false);
    }
  }

  return (
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

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3>Profile</h3>
          <p>Your username is permanent; your display name updates across all group history.</p>
        </div>
        {user?.nameSyncPending ? (
          <p className={styles.syncNote}>A previous name change still needs to finish syncing. Save the current name again to retry.</p>
        ) : null}
        <form onSubmit={handleNameSave} className={styles.form}>
          <label>
            <span className="ui-formLabel">Display name</span>
            <input className={cx("ui-textInput", styles.input)} value={name} onChange={(event) => setName(event.target.value)} maxLength={80} />
          </label>
          <label>
            <span className="ui-formLabel">Current password</span>
            <input className={cx("ui-textInput", styles.input)} type="password" autoComplete="current-password" value={namePassword} onChange={(event) => setNamePassword(event.target.value)} />
          </label>
          {nameError ? <p className="ui-errorBox">{nameError}</p> : null}
          {nameStatus ? <p className={styles.success} role="status">{nameStatus}</p> : null}
          <button className={cx("ui-primaryButton", styles.saveButton)} disabled={nameBusy || !name.trim() || !namePassword}>
            {nameBusy ? "Updating…" : "Save profile"}
          </button>
        </form>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3>Notifications</h3>
          <p>Manage push permission for this browser or installed app.</p>
        </div>
        <EnableNotifications />
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3>Password</h3>
          <p>Use at least six characters for your new password.</p>
        </div>
        <form onSubmit={handlePasswordSave} className={styles.form}>
          <label><span className="ui-formLabel">Current password</span><input className={cx("ui-textInput", styles.input)} type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
          <label><span className="ui-formLabel">New password</span><input className={cx("ui-textInput", styles.input)} type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={6} /></label>
          <label><span className="ui-formLabel">Confirm new password</span><input className={cx("ui-textInput", styles.input)} type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={6} /></label>
          {passwordError ? <p className="ui-errorBox">{passwordError}</p> : null}
          {passwordStatus ? <p className={styles.success} role="status">{passwordStatus}</p> : null}
          <button className={cx("ui-primaryButton", styles.saveButton)} disabled={passwordBusy || !currentPassword || newPassword.length < 6 || !confirmPassword}>
            {passwordBusy ? "Updating…" : "Update password"}
          </button>
        </form>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}><h3>Session</h3><p>Manage this device’s signed-in state.</p></div>
        <button type="button" onClick={logout} className={styles.signOutButton}>Sign out</button>
      </section>

      <section className={styles.dangerSection}>
        <div className={styles.sectionHeader}><h3>Danger zone</h3><p>Deleting your account removes memberships and notification subscriptions.</p></div>
        <form onSubmit={handleDeleteAccount} className={styles.form}>
          <label><span className="ui-formLabel">Current password</span><input className={cx("ui-textInput", styles.input)} type="password" autoComplete="current-password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} /></label>
          {deleteError ? <p className="ui-errorBox">{deleteError}</p> : null}
          <button className={styles.deleteButton} disabled={deleteBusy || !deletePassword}>{deleteBusy ? "Deleting…" : "Delete account"}</button>
        </form>
      </section>
      {confirmationDialog}
    </div>
  );
}
