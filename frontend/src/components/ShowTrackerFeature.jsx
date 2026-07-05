import { useRef, useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { adjustEpisode, joinShow, leaveShow, setEpisode } from "../api/client.js";
import { initialOf } from "../utils/avatar.js";
import { cx } from "../utils/classNames.js";
import { relativeTime } from "../utils/time.js";
import styles from "./styling/ShowTrackerFeature.module.css";

// How long the counter must be held before it flips into manual-edit mode.
const LONG_PRESS_MS = 500;

// Watcher sub-entry: roommate name, their episode, and a +/edit pill. Episode
// edits are open to everyone, so no ownership check gates the controls.
// Tapping + advances an episode; long-pressing the number opens a text field
// to type an exact episode.
function WatcherRow({ member, busy, onAdjust, onSetEpisode, onRemove }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const pressTimer = useRef(null);
  // Guards against onBlur double-firing after Enter/Escape already finished.
  const finished = useRef(false);

  function beginEdit() {
    finished.current = false;
    setDraft(String(member.episode));
    setEditing(true);
  }

  function startPress() {
    if (busy) return;
    cancelPress();
    pressTimer.current = setTimeout(beginEdit, LONG_PRESS_MS);
  }

  function cancelPress() {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }

  // apply=true commits the typed value; apply=false discards it.
  function finishEdit(apply) {
    if (finished.current) return;
    finished.current = true;
    setEditing(false);
    if (!apply) return;
    const next = Number.parseInt(draft, 10);
    if (Number.isNaN(next) || next === member.episode) return;
    onSetEpisode(member, Math.max(0, next));
  }

  return (
    <li className={styles.watcher}>
      <span className={styles.watcherAvatar} title={member.name}>
        {initialOf(member.name)}
      </span>
      <div className={styles.watcherText}>
        <p className={styles.watcherName}>{member.name}</p>
        <p className={styles.watcherEpisode}>Episode {member.episode}</p>
      </div>

      <div className={styles.pill}>
        {editing ? (
          <input
            type="number"
            min="0"
            inputMode="numeric"
            autoFocus
            value={draft}
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => finishEdit(true)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                finishEdit(true);
              } else if (event.key === "Escape") {
                event.preventDefault();
                finishEdit(false);
              }
            }}
            className={styles.pillInput}
            aria-label={`Set ${member.name}'s episode`}
          />
        ) : (
          <span
            role="button"
            tabIndex={0}
            className={styles.pillValue}
            title="Long-press to edit episode"
            onPointerDown={startPress}
            onPointerUp={cancelPress}
            onPointerLeave={cancelPress}
            onPointerCancel={cancelPress}
          >
            {member.episode}
          </span>
        )}
        <button
          type="button"
          disabled={busy || editing}
          onClick={() => onAdjust(member, 1)}
          className={styles.pillButton}
          aria-label={`Increase ${member.name}'s episode`}
          title="Forward one episode"
        >
          +
        </button>
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={() => onRemove(member)}
        className={styles.watcherRemove}
        aria-label={`Remove ${member.name} from this show`}
        title="Remove watcher"
      >
        ×
      </button>
    </li>
  );
}

export default function ShowTrackerFeature({ shows, onShowsChange }) {
  const { user } = useAuth();
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  // Per-member ids with an in-flight episode/leave request, to disable controls.
  const [busyMemberIds, setBusyMemberIds] = useState([]);
  // Show id with an in-flight self-join request, to disable its Join button.
  const [joiningShowId, setJoiningShowId] = useState(null);

  function toggleExpanded(id) {
    setExpandedId((current) => (current === id ? null : id));
  }

  function markMemberBusy(id) {
    setBusyMemberIds((current) => [...current, id]);
  }

  function clearMemberBusy(id) {
    setBusyMemberIds((current) => current.filter((busyId) => busyId !== id));
  }

  // Add the current user to the show. Mirrors the proposed-activity Join flow:
  // the button is only shown to non-watchers, so clicking always joins the
  // person who clicked — no roommate picker.
  async function handleJoin(show) {
    if (joiningShowId) return;
    setJoiningShowId(show.id);
    setError("");
    try {
      onShowsChange(await joinShow(show.id, user.id, user.name));
    } catch (err) {
      setError(err.message || "Could not join the show. Try again.");
    } finally {
      setJoiningShowId(null);
    }
  }

  async function handleAdjust(show, member, delta) {
    if (busyMemberIds.includes(member.id)) return;
    markMemberBusy(member.id);
    setError("");
    try {
      onShowsChange(await adjustEpisode(show.id, member.id, delta));
    } catch (err) {
      setError(err.message || "Could not update the episode. Try again.");
    } finally {
      clearMemberBusy(member.id);
    }
  }

  async function handleSetEpisode(show, member, episode) {
    if (busyMemberIds.includes(member.id)) return;
    markMemberBusy(member.id);
    setError("");
    try {
      onShowsChange(await setEpisode(show.id, member.id, episode));
    } catch (err) {
      setError(err.message || "Could not update the episode. Try again.");
    } finally {
      clearMemberBusy(member.id);
    }
  }

  async function handleRemove(show, member) {
    if (busyMemberIds.includes(member.id)) return;
    markMemberBusy(member.id);
    setError("");
    try {
      onShowsChange(await leaveShow(show.id, member.id));
    } catch (err) {
      setError(err.message || "Could not remove the watcher. Try again.");
    } finally {
      clearMemberBusy(member.id);
    }
  }

  return (
    <div className={styles.wrap}>
      {error && <p className={cx("ui-errorText", styles.error)}>{error}</p>}

      <div className={styles.list}>
        {shows.length === 0 ? (
          <p className={styles.empty}>No shows yet. Add one to get started.</p>
        ) : (
          shows.map((show) => {
            const expanded = expandedId === show.id;
            // Only non-watchers see the Join button; clicking it adds them.
            const isMember = show.members.some(
              (member) => member.id === user.id,
            );
            return (
              <div
                key={show.id}
                role="button"
                tabIndex={0}
                aria-expanded={expanded}
                onClick={() => toggleExpanded(show.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    toggleExpanded(show.id);
                  }
                }}
                className={styles.card}
              >
                <div className={styles.summary}>
                  <div className={styles.summaryText}>
                    <p className={styles.title}>{show.title}</p>
                    <p className={styles.meta}>
                      {show.members.length}{" "}
                      {show.members.length === 1 ? "watcher" : "watchers"} ·
                      added {relativeTime(show.createdAt)}
                    </p>
                  </div>
                  {!isMember && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleJoin(show);
                      }}
                      disabled={joiningShowId === show.id}
                      className={cx(
                        "ui-pillButton ui-pillPrimary",
                        styles.joinButton,
                      )}
                    >
                      {joiningShowId === show.id ? "Joining…" : "Join"}
                    </button>
                  )}
                </div>

                <div
                  className={cx(
                    styles.expandedRegion,
                    expanded ? styles.expanded : styles.collapsed,
                  )}
                >
                  <div
                    className={styles.expandedInner}
                    {...(!expanded ? { inert: "" } : {})}
                  >
                    <div
                      className={styles.panel}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      {show.members.length === 0 ? (
                        <p className={styles.watchersEmpty}>
                          No one&apos;s watching yet — tap Join to start
                          tracking.
                        </p>
                      ) : (
                        <ul className={styles.watchers}>
                          {show.members.map((member) => (
                            <WatcherRow
                              key={member.id}
                              member={member}
                              busy={busyMemberIds.includes(member.id)}
                              onAdjust={(target, delta) =>
                                handleAdjust(show, target, delta)
                              }
                              onSetEpisode={(target, episode) =>
                                handleSetEpisode(show, target, episode)
                              }
                              onRemove={(target) => handleRemove(show, target)}
                            />
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
