import { useMemo, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import {
  adjustProgress,
  completeShow,
  joinShow,
  leaveShow,
  reopenShow,
  setProgress,
} from "../api/client.js";
import { initialOf } from "../utils/avatar.js";
import { cx } from "../utils/classNames.js";
import { relativeTime } from "../utils/time.js";
import styles from "./styling/ShowTrackerFeature.module.css";

// How long the counter must be held before it flips into manual-edit mode.
const LONG_PRESS_MS = 500;

// A single labeled counter: shows a value with a + button that advances it, and
// long-pressing the number opens a text field to type an exact value. Season
// and episode each render one of these, so the long-press logic lives here once.
function CounterPill({ label, name, noun, value, busy, onIncrement, onSet }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const pressTimer = useRef(null);
  // Guards against onBlur double-firing after Enter/Escape already finished.
  const finished = useRef(false);

  function beginEdit() {
    finished.current = false;
    setDraft(String(value));
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
    if (Number.isNaN(next) || next === value) return;
    onSet(Math.max(1, next));
  }

  return (
    <div className={styles.counter}>
      <span className={styles.counterLabel}>{label}</span>
      <div className={styles.pill}>
        {editing ? (
          <input
            type="number"
            min="1"
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
            aria-label={`Set ${name}'s ${noun}`}
          />
        ) : (
          <span
            role="button"
            tabIndex={0}
            className={styles.pillValue}
            title={`Long-press to edit ${noun}`}
            onPointerDown={startPress}
            onPointerUp={cancelPress}
            onPointerLeave={cancelPress}
            onPointerCancel={cancelPress}
          >
            {value}
          </span>
        )}
        <button
          type="button"
          disabled={busy || editing}
          onClick={onIncrement}
          className={styles.pillButton}
          aria-label={`Increase ${name}'s ${noun}`}
          title={`Forward one ${noun}`}
        >
          +
        </button>
      </div>
    </div>
  );
}

// Watcher sub-entry: roommate name plus independent season and episode counters.
// Edits are open to everyone, so no ownership check gates the controls. A
// completed show renders read-only, so its watchers show progress without the
// +/edit/remove controls.
function WatcherRow({ member, busy, readOnly, onAdjust, onSetProgress, onRemove }) {
  return (
    <li className={styles.watcher}>
      <div className={styles.watcherHead}>
        <span className={styles.watcherAvatar} title={member.name}>
          {initialOf(member.name)}
        </span>
        <div className={styles.watcherText}>
          <p className={styles.watcherName}>{member.name}</p>
          <p className={styles.watcherEpisode}>
            Season {member.season} · Episode {member.episode}
          </p>
        </div>
        {!readOnly && (
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
        )}
      </div>

      {!readOnly && (
        <div className={styles.counters}>
          <CounterPill
            label="Season"
            noun="season"
            name={member.name}
            value={member.season}
            busy={busy}
            onIncrement={() => onAdjust(member, "season", 1)}
            onSet={(value) => onSetProgress(member, "season", value)}
          />
          <CounterPill
            label="Episode"
            noun="episode"
            name={member.name}
            value={member.episode}
            busy={busy}
            onIncrement={() => onAdjust(member, "episode", 1)}
            onSet={(value) => onSetProgress(member, "episode", value)}
          />
        </div>
      )}
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
  // Show id with an in-flight complete/reopen request, to disable that button.
  const [completingShowId, setCompletingShowId] = useState(null);
  // Whether the collapsed "Completed" section is expanded.
  const [showCompleted, setShowCompleted] = useState(false);

  // Split shows the way activities split current vs. expired: completed ones
  // drop out of the main list into a collapsible section.
  const { activeShows, completedShows } = useMemo(
    () => ({
      activeShows: shows.filter((show) => !show.completed),
      completedShows: shows.filter((show) => show.completed),
    }),
    [shows],
  );

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

  // Creator-only: flip a show between completed and active. The same button
  // completes an active show and reopens a completed one.
  async function handleToggleComplete(show) {
    if (completingShowId) return;
    setCompletingShowId(show.id);
    setError("");
    try {
      const updated = show.completed
        ? await reopenShow(show.id, user.id)
        : await completeShow(show.id, user.id);
      onShowsChange(updated);
    } catch (err) {
      setError(
        err.message ||
          `Could not ${show.completed ? "reopen" : "complete"} the show. Try again.`,
      );
    } finally {
      setCompletingShowId(null);
    }
  }

  async function handleAdjust(show, member, field, delta) {
    if (busyMemberIds.includes(member.id)) return;
    markMemberBusy(member.id);
    setError("");
    try {
      onShowsChange(await adjustProgress(show.id, member.id, field, delta, user.id));
    } catch (err) {
      setError(err.message || `Could not update the ${field}. Try again.`);
    } finally {
      clearMemberBusy(member.id);
    }
  }

  async function handleSetProgress(show, member, field, value) {
    if (busyMemberIds.includes(member.id)) return;
    markMemberBusy(member.id);
    setError("");
    try {
      onShowsChange(await setProgress(show.id, member.id, field, value, user.id));
    } catch (err) {
      setError(err.message || `Could not update the ${field}. Try again.`);
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

  function renderShow(show) {
    const expanded = expandedId === show.id;
    const completed = show.completed;
    // Only non-watchers see the Join button; clicking it adds them.
    const isMember = show.members.some((member) => member.id === user.id);
    // Only the creator sees the complete/reopen control.
    const isCreator = show.createdById === user.id;
    // Furthest-along watchers first: sort by season, then episode, descending.
    // Copied so we never mutate the show list's member array in place.
    const orderedMembers = [...show.members].sort(
      (a, b) => b.season - a.season || b.episode - a.episode,
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
        className={cx(styles.card, completed ? styles.completedCard : "")}
      >
        <div className={styles.summary}>
          <div className={styles.summaryText}>
            <div className={styles.titleRow}>
              <p className={styles.title}>{show.title}</p>
              {completed && (
                <span className={styles.completedChip}>Completed</span>
              )}
            </div>
            <p className={styles.meta}>
              {show.members.length}{" "}
              {show.members.length === 1 ? "watcher" : "watchers"} · added{" "}
              {relativeTime(show.createdAt)}
            </p>
          </div>
          {!completed && !isMember && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                handleJoin(show);
              }}
              disabled={joiningShowId === show.id}
              className={cx("ui-pillButton ui-pillPrimary", styles.joinButton)}
            >
              {joiningShowId === show.id ? "Joining…" : "Join"}
            </button>
          )}
          {isCreator && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                handleToggleComplete(show);
              }}
              disabled={completingShowId === show.id}
              className={cx("ui-pillButton ui-pillSecondary", styles.joinButton)}
            >
              {completingShowId === show.id
                ? completed
                  ? "Reopening…"
                  : "Completing…"
                : completed
                  ? "Reopen"
                  : "Complete"}
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
                  {completed
                    ? "No watchers."
                    : "No one's watching yet — tap Join to start tracking."}
                </p>
              ) : (
                <ul className={styles.watchers}>
                  {orderedMembers.map((member) => (
                    <WatcherRow
                      key={member.id}
                      member={member}
                      busy={busyMemberIds.includes(member.id)}
                      readOnly={completed}
                      onAdjust={(target, field, delta) =>
                        handleAdjust(show, target, field, delta)
                      }
                      onSetProgress={(target, field, value) =>
                        handleSetProgress(show, target, field, value)
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
  }

  return (
    <div className={styles.wrap}>
      {error && <p className={cx("ui-errorText", styles.error)}>{error}</p>}

      <div className={styles.list}>
        {shows.length === 0 ? (
          <p className={styles.empty}>No shows yet. Add one to get started.</p>
        ) : activeShows.length === 0 ? (
          <p className={styles.empty}>
            No active shows — completed ones are below.
          </p>
        ) : (
          activeShows.map(renderShow)
        )}
      </div>

      {completedShows.length > 0 && (
        <div className={styles.completedSection}>
          <button
            type="button"
            onClick={() => setShowCompleted((current) => !current)}
            className={styles.completedToggle}
            aria-expanded={showCompleted}
          >
            <span>Completed shows ({completedShows.length})</span>
            <span aria-hidden="true">{showCompleted ? "▴" : "▾"}</span>
          </button>
          {showCompleted && (
            <div className={styles.list}>{completedShows.map(renderShow)}</div>
          )}
        </div>
      )}
    </div>
  );
}
