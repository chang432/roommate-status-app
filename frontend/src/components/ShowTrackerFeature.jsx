import { useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { adjustEpisode, joinShow, leaveShow } from "../api/client.js";
import { initialOf } from "../utils/avatar.js";
import { cx } from "../utils/classNames.js";
import { relativeTime } from "../utils/time.js";
import styles from "./styling/ShowTrackerFeature.module.css";

// Watcher sub-entry: roommate name, their episode, and a +/- pill. Episode
// edits are open to everyone, so no ownership check gates the buttons.
function WatcherRow({ member, busy, onAdjust, onRemove }) {
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
        <button
          type="button"
          disabled={busy || member.episode <= 0}
          onClick={() => onAdjust(member, -1)}
          className={styles.pillButton}
          aria-label={`Decrease ${member.name}'s episode`}
          title="Back one episode"
        >
          −
        </button>
        <span className={styles.pillValue}>{member.episode}</span>
        <button
          type="button"
          disabled={busy}
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
