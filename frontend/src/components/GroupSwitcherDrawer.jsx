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
}) {
  const [joining, setJoining] = useState(false);
  const [code, setCode] = useState("");
  const [joinError, setJoinError] = useState("");
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
    if (!code.trim() || submitting) return;
    setSubmitting(true);
    setJoinError("");
    try {
      await onJoin(code);
      setCode("");
      setJoining(false);
      onClose();
    } catch (err) {
      setJoinError(err.message || "Could not join that group.");
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
          {!joining ? (
            <button type="button" className={styles.joinButton} onClick={() => setJoining(true)}>
              <span aria-hidden="true">+</span> Join a group
            </button>
          ) : (
            <form onSubmit={handleSubmit} className={styles.joinForm}>
              <label htmlFor="group-invite-code" className={styles.joinLabel}>Invite code</label>
              <div className={styles.joinFields}>
                <input
                  id="group-invite-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  autoComplete="off"
                  autoFocus
                  disabled={submitting}
                />
                <button type="submit" disabled={submitting}>{submitting ? "Joining…" : "Join"}</button>
              </div>
              {joinError && <p className={styles.error}>{joinError}</p>}
              <button type="button" className={styles.cancel} onClick={() => setJoining(false)} disabled={submitting}>
                Cancel
              </button>
            </form>
          )}
        </section>
      </aside>
    </>
  );
}
