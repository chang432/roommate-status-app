import { useEffect, useState } from "react";
import { avatarColor, initialOf } from "../utils/avatar.js";
import { cx } from "../utils/classNames.js";
import styles from "./styling/GroupSwitcherDrawer.module.css";

export default function GroupSwitcherDrawer({
  groups,
  activeGroupId,
  open,
  loading,
  error,
  onClose,
  onSelect,
  onJoin,
  onCreate,
}) {
  const [mode, setMode] = useState(null);
  const [value, setValue] = useState("");
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!value.trim() || submitting) return;
    setSubmitting(true);
    setFormError("");
    try {
      await (mode === "create" ? onCreate(value) : onJoin(value));
      setValue("");
      setMode(null);
      onClose();
    } catch (err) {
      setFormError(err.message || `Could not ${mode} that group.`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {open && (
        <button
          type="button"
          className={styles.backdrop}
          aria-label="Close group switcher"
          onClick={onClose}
        />
      )}
      <aside
        className={cx(styles.drawer, open ? styles.open : "")}
        aria-label="Your groups"
        aria-hidden={!open}
        inert={open ? undefined : ""}
      >
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Your groups</p>
            <h2 className={styles.title}>Home</h2>
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close group switcher">
            ×
          </button>
        </header>

        <section className={styles.section} aria-label="Group memberships">
          {loading && <p className={styles.state}>Loading groups…</p>}
          {error && <p className={styles.error}>{error}</p>}
          {!loading && !error && groups.map((group, index) => (
            <button
              key={group.groupId}
              type="button"
              onClick={() => onSelect(group.groupId)}
              className={cx(styles.groupRow, group.groupId === activeGroupId ? styles.groupRowActive : "")}
              aria-current={group.groupId === activeGroupId ? "page" : undefined}
            >
              <span className={styles.avatar} style={{ backgroundColor: avatarColor(index) }} aria-hidden="true">
                {initialOf(group.name)}
              </span>
              <span className={styles.groupName}>{group.name}</span>
            </button>
          ))}
        </section>

        <section className={styles.joinSection}>
          {!mode ? (
            <div className={styles.groupActions}>
              <button type="button" className={styles.joinButton} onClick={() => setMode("join")}>
                <span aria-hidden="true">+</span> Join a group
              </button>
              <button type="button" className={styles.joinButton} onClick={() => setMode("create")}>
                <span aria-hidden="true">+</span> Create a group
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className={styles.joinForm}>
              <label htmlFor="group-drawer-value" className={styles.joinLabel}>
                {mode === "create" ? "Group name" : "Invite code"}
              </label>
              <div className={styles.joinFields}>
                <input
                  id="group-drawer-value"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  autoComplete={mode === "create" ? "organization" : "off"}
                  autoFocus
                  disabled={submitting}
                  maxLength={mode === "create" ? 80 : 16}
                  className={mode === "join" ? styles.inviteCode : ""}
                />
                <button type="submit" disabled={submitting}>
                  {submitting ? (mode === "create" ? "Creating…" : "Joining…") : mode === "create" ? "Create" : "Join"}
                </button>
              </div>
              {formError && <p className={styles.error}>{formError}</p>}
              <button type="button" className={styles.cancel} onClick={() => setMode(null)} disabled={submitting}>
                Cancel
              </button>
            </form>
          )}
        </section>
      </aside>
    </>
  );
}
