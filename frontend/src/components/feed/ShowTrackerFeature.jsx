import { useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext.jsx";
import { useExpandOnModuleFocus } from "../../context/ModuleFocusContext.jsx";
import {
  adjustProgress,
  archiveShow,
  deleteShow,
  endWatchparty,
  joinShow,
  leaveShow,
  restoreShow,
  setProgress,
  startWatchparty,
} from "../../api/shows.js";
import ModalShell from "../ui/ModalShell.jsx";
import { initialOf } from "../../utils/avatar.js";
import { cx } from "../../utils/classNames.js";
import { LONG_PRESS_MS } from "../../utils/useLongPress.js";
import { relativeTime } from "../../utils/time.js";
import styles from "./ShowTrackerFeature.module.css";

// A single progress chip: tapping increments immediately, while a long press
// opens inline numeric editing for an exact season/episode jump.
function CounterChip({
  label,
  shortLabel,
  name,
  noun,
  value,
  busy,
  readOnly,
  onIncrement,
  onSet,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const pressTimer = useRef(null);
  // Guards against onBlur double-firing after Enter/Escape already finished.
  const finished = useRef(false);
  // A long press should open the editor without also triggering the tap bump.
  const suppressClick = useRef(false);

  function beginEdit() {
    finished.current = false;
    suppressClick.current = true;
    setDraft(String(value));
    setEditing(true);
  }

  function startPress() {
    if (busy || readOnly) return;
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
      <div className={styles.counterValue}>
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
            className={styles.counterInput}
            aria-label={`Set ${name}'s ${noun}`}
          />
        ) : (
          <button
            type="button"
            disabled={busy || readOnly}
            className={readOnly ? styles.counterStatic : styles.counterChip}
            title={
              readOnly
                ? `${label} ${value}`
                : `Tap to advance ${noun}; long-press to edit`
            }
            onPointerDown={startPress}
            onPointerUp={cancelPress}
            onPointerLeave={cancelPress}
            onPointerCancel={cancelPress}
            onClick={(event) => {
              event.stopPropagation();
              cancelPress();
              if (suppressClick.current) {
                suppressClick.current = false;
                return;
              }
              if (!readOnly) onIncrement();
            }}
          >
            <span className={styles.counterChipLabel}>{shortLabel}</span>
            <span className={styles.counterChipValue}>{value}</span>
          </button>
        )}
      </div>
    </div>
  );
}

// Watcher sub-entry: roommate name plus independent season and episode counters.
// Edits are open to everyone, so no ownership check gates the controls. A
// completed show renders read-only, so its watchers show progress without the
// increment/edit/remove controls.
function WatcherRow({
  member,
  busy,
  readOnly,
  onAdjust,
  onSetProgress,
  onRemove,
}) {
  return (
    <li className={styles.watcher}>
      <div className={styles.watcherHead}>
        <span className={styles.watcherAvatar} title={member.name}>
          {initialOf(member.name)}
        </span>
        <p className={styles.watcherName}>{member.name}</p>
        <div className={styles.counters}>
          <CounterChip
            label="Season"
            shortLabel="S"
            noun="season"
            name={member.name}
            value={member.season}
            busy={busy}
            readOnly={readOnly}
            onIncrement={() => onAdjust(member, "season", 1)}
            onSet={(value) => onSetProgress(member, "season", value)}
          />
          <CounterChip
            label="Episode"
            shortLabel="E"
            noun="episode"
            name={member.name}
            value={member.episode}
            busy={busy}
            readOnly={readOnly}
            onIncrement={() => onAdjust(member, "episode", 1)}
            onSet={(value) => onSetProgress(member, "episode", value)}
          />
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
    </li>
  );
}

export default function ShowTrackerFeature({
  shows,
  onShowsChange,
  moduleTag,
  editTrigger,
}) {
  const { user } = useAuth();
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  // Per-member ids with an in-flight episode/leave request, to disable controls.
  const [busyMemberIds, setBusyMemberIds] = useState([]);
  // Show id with an in-flight self-join request, to disable its Join button.
  const [joiningShowId, setJoiningShowId] = useState(null);
  const [archivingShowId, setArchivingShowId] = useState(null);
  const [restoringShowId, setRestoringShowId] = useState(null);
  const [deletingShowId, setDeletingShowId] = useState(null);
  const [watchpartyShowId, setWatchpartyShowId] = useState(null);
  const [watchpartyPrompt, setWatchpartyPrompt] = useState(null);
  const [watchpartyDraft, setWatchpartyDraft] = useState({
    season: "1",
    episode: "1",
  });
  useExpandOnModuleFocus(setExpandedId);

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

  async function handleArchive(show) {
    if (archivingShowId) return;
    setArchivingShowId(show.id);
    setError("");
    try {
      onShowsChange(await archiveShow(show.id, user.id));
    } catch (err) {
      setError(err.message || "Could not archive the show. Try again.");
    } finally {
      setArchivingShowId(null);
    }
  }

  async function handleRestore(show) {
    if (restoringShowId) return;
    setRestoringShowId(show.id);
    setError("");
    try {
      onShowsChange(await restoreShow(show.id, user.id));
    } catch (err) {
      setError(err.message || "Could not restore the show. Try again.");
    } finally {
      setRestoringShowId(null);
    }
  }

  async function handleDelete(show) {
    if (deletingShowId) return;
    setDeletingShowId(show.id);
    setError("");
    try {
      onShowsChange(await deleteShow(show.id, user.id));
      setExpandedId((current) => (current === show.id ? null : current));
    } catch (err) {
      setError(err.message || "Could not delete the show. Try again.");
    } finally {
      setDeletingShowId(null);
    }
  }

  function openWatchpartyPrompt(show) {
    const members = show.members || [];
    const ownProgress = members.find((member) => member.id === user.id);
    const fallbackProgress = members[0] || { season: 1, episode: 1 };
    const progress = ownProgress || fallbackProgress;
    setWatchpartyDraft({
      season: String(Math.max(1, Number.parseInt(progress.season, 10) || 1)),
      episode: String(Math.max(1, Number.parseInt(progress.episode, 10) || 1)),
    });
    setWatchpartyPrompt(show);
  }

  async function handleWatchparty(show, episodeOverride = null) {
    if (watchpartyShowId) return;
    setWatchpartyShowId(show.id);
    setError("");
    try {
      const action = show.isWatchpartyLive ? endWatchparty : startWatchparty;
      onShowsChange(
        await action(
          show.id,
          user.id,
          episodeOverride?.season,
          episodeOverride?.episode,
        ),
      );
      setWatchpartyPrompt(null);
    } catch (err) {
      setError(err.message || "Could not update the watchparty. Try again.");
    } finally {
      setWatchpartyShowId(null);
    }
  }

  function handleWatchpartySubmit(event) {
    event.preventDefault();
    if (!watchpartyPrompt) return;
    const season = Math.max(
      1,
      Number.parseInt(watchpartyDraft.season, 10) || 1,
    );
    const episode = Math.max(
      1,
      Number.parseInt(watchpartyDraft.episode, 10) || 1,
    );
    handleWatchparty(watchpartyPrompt, { season, episode });
  }

  async function handleAdjust(show, member, field, delta) {
    if (busyMemberIds.includes(member.id)) return;
    markMemberBusy(member.id);
    setError("");
    try {
      onShowsChange(
        await adjustProgress(show.id, member.id, field, delta, user.id),
      );
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
      onShowsChange(
        await setProgress(show.id, member.id, field, value, user.id),
      );
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
    const isArchived = show.isArchived;
    // Only non-watchers see the Join button; clicking it adds them.
    const isMember = show.members.some((member) => member.id === user.id);
    const orderedMembers = [...show.members].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
    return (
      <div
        key={show.id}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        {...editTrigger.keyboardProps}
        onClick={() => toggleExpanded(show.id)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggleExpanded(show.id);
          }
        }}
        className={cx(
          show.isWatchpartyLive ? styles.activeCard : styles.card,
          isArchived ? styles.completedCard : "",
        )}
      >
        <div className={styles.summary} {...editTrigger.headerProps}>
          <div className={styles.summaryText}>
            <div className={styles.titleRow}>
              {moduleTag}
              <p className={styles.title}>{show.title}</p>
              {isArchived && (
                <span className={styles.completedChip}>Archived</span>
              )}
              {show.isWatchpartyLive && (
                <span className={styles.liveChip}>Live</span>
              )}
            </div>
            <p className={styles.meta}>
              {show.members.length}{" "}
              {show.members.length === 1 ? "watcher" : "watchers"} · added{" "}
              {relativeTime(show.createdAt)}
            </p>
          </div>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              if (show.isWatchpartyLive) {
                handleWatchparty(show);
              } else {
                openWatchpartyPrompt(show);
              }
            }}
            disabled={watchpartyShowId === show.id}
            className={cx(
              "ui-pillButton",
              show.isWatchpartyLive ? "ui-pillDanger" : "ui-pillPrimary",
              styles.showActionButton,
            )}
          >
            {watchpartyShowId === show.id
              ? show.isWatchpartyLive
                ? "Ending…"
                : "Starting…"
              : show.isWatchpartyLive
                ? "End"
                : "Start"}
          </button>
          {!isArchived && !isMember && (
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
                  {isArchived
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
                      readOnly={isArchived}
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
              <div
                className={styles.showActions}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
                <span className={styles.showActionText}>
                  {isArchived ? "Archived show" : "Show actions"}
                </span>
                {isArchived ? (
                  <button
                    type="button"
                    onClick={() => handleRestore(show)}
                    disabled={Boolean(restoringShowId || deletingShowId)}
                    className={cx(
                      "ui-pillButton ui-pillSecondary",
                      styles.showActionButton,
                    )}
                  >
                    {restoringShowId === show.id ? "Restoring…" : "Restore"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleArchive(show)}
                    disabled={Boolean(archivingShowId || deletingShowId)}
                    className={cx(
                      "ui-pillButton ui-pillSecondary",
                      styles.showActionButton,
                    )}
                  >
                    {archivingShowId === show.id ? "Archiving…" : "Archive"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleDelete(show)}
                  disabled={Boolean(
                    (isArchived ? restoringShowId : archivingShowId) ||
                    deletingShowId,
                  )}
                  className={cx(
                    "ui-pillButton ui-pillDanger",
                    styles.showActionButton,
                  )}
                >
                  {deletingShowId === show.id ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      {error && <p className={cx("ui-errorText", styles.error)}>{error}</p>}

      {watchpartyPrompt && (
        <ModalShell
          title="Start Watchparty"
          ariaLabel={`Start ${watchpartyPrompt.title} watchparty`}
          onClose={() => setWatchpartyPrompt(null)}
          widthClassName={styles.watchpartyDialog}
        >
          <form
            className={styles.watchpartyForm}
            onSubmit={handleWatchpartySubmit}
          >
            <p className={styles.watchpartyTitle}>{watchpartyPrompt.title}</p>
            <div className={styles.watchpartyFields}>
              <label className={styles.watchpartyField}>
                <span>Season</span>
                <input
                  type="number"
                  min="1"
                  inputMode="numeric"
                  value={watchpartyDraft.season}
                  onChange={(event) =>
                    setWatchpartyDraft((current) => ({
                      ...current,
                      season: event.target.value,
                    }))
                  }
                />
              </label>
              <label className={styles.watchpartyField}>
                <span>Episode</span>
                <input
                  type="number"
                  min="1"
                  inputMode="numeric"
                  value={watchpartyDraft.episode}
                  onChange={(event) =>
                    setWatchpartyDraft((current) => ({
                      ...current,
                      episode: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
            <div className={styles.watchpartyModalActions}>
              <button
                type="button"
                onClick={() => setWatchpartyPrompt(null)}
                className={cx(
                  "ui-pillButton ui-pillSecondary",
                  styles.showActionButton,
                )}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={watchpartyShowId === watchpartyPrompt.id}
                className={cx(
                  "ui-pillButton ui-pillPrimary",
                  styles.showActionButton,
                )}
              >
                {watchpartyShowId === watchpartyPrompt.id
                  ? "Starting…"
                  : "Start"}
              </button>
            </div>
          </form>
        </ModalShell>
      )}

      <div className={styles.list}>
        {shows.length === 0 ? (
          <p className={styles.empty}>No shows yet. Add one to get started.</p>
        ) : (
          shows.map(renderShow)
        )}
      </div>
    </div>
  );
}
