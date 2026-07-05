import { useState } from "react";
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

export default function ShowTrackerFeature({
  shows,
  onShowsChange,
  roommates,
}) {
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  // Show id whose "add watcher" roommate picker is currently open.
  const [pickerShowId, setPickerShowId] = useState(null);
  // Per-member ids with an in-flight episode/leave request, to disable controls.
  const [busyMemberIds, setBusyMemberIds] = useState([]);
  // Per-roommate ids being added via the picker, to disable their chip.
  const [joiningIds, setJoiningIds] = useState([]);

  function toggleExpanded(id) {
    setExpandedId((current) => (current === id ? null : id));
    setPickerShowId(null);
  }

  function markMemberBusy(id) {
    setBusyMemberIds((current) => [...current, id]);
  }

  function clearMemberBusy(id) {
    setBusyMemberIds((current) => current.filter((busyId) => busyId !== id));
  }

  // Open the roommate picker for a show, expanding the row so it's visible.
  function openPicker(show) {
    setExpandedId(show.id);
    setPickerShowId((current) => (current === show.id ? null : show.id));
  }

  async function handleJoin(show, roommate) {
    if (joiningIds.includes(roommate.id)) return;
    setJoiningIds((current) => [...current, roommate.id]);
    setError("");
    try {
      onShowsChange(await joinShow(show.id, roommate.id, roommate.name));
    } catch (err) {
      setError(err.message || "Could not join the show. Try again.");
    } finally {
      setJoiningIds((current) => current.filter((id) => id !== roommate.id));
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
            const memberIds = new Set(show.members.map((member) => member.id));
            // Roommates not yet watching this show are the picker's candidates.
            const available = roommates.filter((r) => !memberIds.has(r.id));
            const pickerOpen = pickerShowId === show.id;
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
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      openPicker(show);
                    }}
                    className={cx(
                      "ui-pillButton ui-pillSecondary",
                      styles.joinButton,
                    )}
                  >
                    Join
                  </button>
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
                      {pickerOpen && (
                        <div className={styles.picker}>
                          <p className={styles.pickerLabel}>
                            Add a roommate to this show
                          </p>
                          {available.length === 0 ? (
                            <p className={styles.pickerEmpty}>
                              Everyone&apos;s already watching.
                            </p>
                          ) : (
                            <div className={styles.pickerChips}>
                              {available.map((roommate) => (
                                <button
                                  key={roommate.id}
                                  type="button"
                                  disabled={joiningIds.includes(roommate.id)}
                                  onClick={() => handleJoin(show, roommate)}
                                  className={styles.pickerChip}
                                >
                                  {roommate.name}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {show.members.length === 0 ? (
                        <p className={styles.watchersEmpty}>
                          No one&apos;s watching yet — tap Join to add a
                          roommate.
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
