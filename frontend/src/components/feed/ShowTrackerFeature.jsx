import { useState } from "react";
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
import { useConfirmDialog } from "../ui/useConfirmDialog.jsx";
import ModuleEditButton from "./ModuleEditButton.jsx";
import ExpandableCardRegion from "./ExpandableCardRegion.jsx";
import WatcherRow from "./ShowProgressControls.jsx";
import WatchpartyDialog from "./WatchpartyDialog.jsx";
import { cx } from "../../utils/classNames.js";
import { relativeTime } from "../../utils/time.js";
import styles from "./ShowTrackerFeature.module.css";


export default function ShowTrackerFeature({
  show,
  onShowsChange,
  moduleTag,
  onEdit,
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
  const { confirm, confirmationDialog } = useConfirmDialog();
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
    const confirmed = await confirm({
      title: `Delete ${show.title}?`,
      message:
        "This permanently removes the show and every watcher's saved progress.",
      confirmLabel: "Delete show",
    });
    if (!confirmed) return;
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
    if (show.isWatchpartyLive) {
      const confirmed = await confirm({
        title: `End ${show.title} watchparty?`,
        message: "This stops the live watchparty for everyone in the group.",
        confirmLabel: "End watchparty",
      });
      if (!confirmed) return;
    }
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
    const confirmed = await confirm({
      title: `Remove ${member.name} from ${show.title}?`,
      message: `${member.name}'s saved season and episode progress will be removed.`,
      confirmLabel: "Remove watcher",
    });
    if (!confirmed) return;
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
        className={cx(
          show.isWatchpartyLive ? styles.activeCard : styles.card,
          isArchived ? styles.completedCard : "",
        )}
      >
        <div className={styles.summary}>
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

        <ExpandableCardRegion expanded={expanded} className={styles.panel}>
          <div
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
              className="ui-moduleActionRow"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <span className={styles.showActionText}>
                {isArchived ? "Archived show" : "Show actions"}
              </span>
              <ModuleEditButton
                onEdit={onEdit}
                disabled={Boolean(
                  restoringShowId || archivingShowId || deletingShowId,
                )}
              />
              {isArchived ? (
                <button
                  type="button"
                  onClick={() => handleRestore(show)}
                  disabled={Boolean(restoringShowId || deletingShowId)}
                  className="ui-pillButton ui-pillSecondary ui-moduleActionButton"
                >
                  {restoringShowId === show.id ? "Restoring…" : "Restore"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleArchive(show)}
                  disabled={Boolean(archivingShowId || deletingShowId)}
                  className="ui-pillButton ui-pillSecondary ui-moduleActionButton"
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
                className="ui-pillButton ui-pillDanger ui-moduleActionButton"
              >
                {deletingShowId === show.id ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </ExpandableCardRegion>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      {error && <p className={cx("ui-errorText", styles.error)}>{error}</p>}

      <WatchpartyDialog
        show={watchpartyPrompt}
        draft={watchpartyDraft}
        busy={watchpartyShowId === watchpartyPrompt?.id}
        onClose={() => setWatchpartyPrompt(null)}
        onSubmit={handleWatchpartySubmit}
        onChange={(field, value) =>
          setWatchpartyDraft((current) => ({ ...current, [field]: value }))
        }
      />

      {renderShow(show)}
      {confirmationDialog}
    </div>
  );
}
