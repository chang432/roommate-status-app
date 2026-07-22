import { useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { useExpandOnModuleFocus } from "../context/ModuleFocusContext.jsx";
import {
  archiveActivity,
  deleteActivity,
  joinActivity,
  leaveActivity,
  commentOnActivity,
  restoreActivity,
  setCommentLiked,
} from "../api/client.js";
import FeedComments from "./FeedComments.jsx";
import { activityTimeLabel, relativeTime } from "../utils/time.js";
import { cx } from "../utils/classNames.js";
import styles from "./styling/ProposeActivity.module.css";

export default function ProposeActivity({
  activities,
  onActivitiesChange,
  transitioningId,
  onLiveTransition,
  roommates,
  moduleTag,
  editTrigger,
}) {
  const { user } = useAuth();
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [joiningId, setJoiningId] = useState(null);
  const [commentText, setCommentText] = useState("");
  const [commentingId, setCommentingId] = useState(null);
  const [likingCommentIds, setLikingCommentIds] = useState([]);
  const [openLikesCommentId, setOpenLikesCommentId] = useState(null);
  const [archivingId, setArchivingId] = useState(null);
  const [restoringId, setRestoringId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  useExpandOnModuleFocus(setExpandedId);

  function toggleExpanded(id) {
    setExpandedId((current) => (current === id ? null : id));
    setCommentText("");
    setOpenLikesCommentId(null);
  }

  async function handleDelete(activity) {
    if (deletingId) return;
    setDeletingId(activity.id);
    setError("");
    try {
      onActivitiesChange(await deleteActivity(activity.id, user.id));
      setExpandedId((current) => (current === activity.id ? null : current));
    } catch (err) {
      setError(err.message || "Could not delete the activity. Try again.");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleArchive(activity) {
    if (archivingId) return;
    setArchivingId(activity.id);
    setError("");
    try {
      onActivitiesChange(await archiveActivity(activity.id, user.id));
    } catch (err) {
      setError(err.message || "Could not archive the activity. Try again.");
    } finally {
      setArchivingId(null);
    }
  }

  async function handleRestore(activity) {
    if (restoringId) return;
    setRestoringId(activity.id);
    setError("");
    try {
      onActivitiesChange(await restoreActivity(activity.id, user.id));
    } catch (err) {
      setError(err.message || "Could not restore the activity. Try again.");
    } finally {
      setRestoringId(null);
    }
  }

  async function handleToggleMember(activity, isMember) {
    if (joiningId) return;
    setJoiningId(activity.id);
    setError("");
    try {
      const updated = isMember
        ? await leaveActivity(activity.id, user.id)
        : await joinActivity(activity.id, user.id);
      onActivitiesChange(updated);
    } catch (err) {
      setError(
        err.message ||
          `Could not ${isMember ? "leave" : "join"} the activity. Try again.`,
      );
    } finally {
      setJoiningId(null);
    }
  }

  async function handleComment(event, activity) {
    event.preventDefault();
    const trimmed = commentText.trim();
    if (!trimmed || commentingId) return;
    setCommentingId(activity.id);
    setError("");
    try {
      onActivitiesChange(
        await commentOnActivity(activity.id, user.id, trimmed),
      );
      setCommentText("");
    } catch (err) {
      setError(err.message || "Could not post your comment. Try again.");
    } finally {
      setCommentingId(null);
    }
  }

  async function handleCommentLike(activity, comment) {
    if (likingCommentIds.includes(comment.id)) return;
    setLikingCommentIds((current) => [...current, comment.id]);
    setError("");
    try {
      const liked = (comment.likedByIds ?? []).includes(user.id);
      onActivitiesChange(
        await setCommentLiked(activity.id, comment.id, user.id, !liked),
      );
    } catch (err) {
      setError(err.message || "Could not update the comment like. Try again.");
    } finally {
      setLikingCommentIds((current) =>
        current.filter((id) => id !== comment.id),
      );
    }
  }

  function renderActivity(activity) {
    const members = activity.members ?? [];
    const comments = activity.comments ?? [];
    const isMember = (activity.memberIds ?? []).includes(user.id);
    const isOwner = activity.proposedById === user.id;
    const expanded = expandedId === activity.id;
    const scheduleLabel = activityTimeLabel(activity);
    const isArchived = Boolean(activity.isArchived || activity.isExpired);
    return (
      <div
        key={activity.id}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        {...editTrigger.keyboardProps}
        onClick={() => toggleExpanded(activity.id)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggleExpanded(activity.id);
          }
        }}
        className={cx(
          activity.isLive ? styles.activeCard : styles.card,
          isArchived ? styles.expiredCard : "",
        )}
      >
        <div className={styles.summary} {...editTrigger.headerProps}>
          <div className={styles.summaryText}>
            <div className={styles.titleRow}>
              {moduleTag}
              <p className={styles.activityText}>{activity.text}</p>
              {activity.isLive && <span className={styles.liveChip}>Live</span>}
              {isArchived && (
                <span className={styles.expiredChip}>
                  {activity.isArchived ? "Archived" : "Expired"}
                </span>
              )}
            </div>
            <p className={styles.meta}>
              {activity.proposedBy} · {relativeTime(activity.createdAt)}
            </p>
            {scheduleLabel && (
              <p className={styles.scheduleMeta}>{scheduleLabel}</p>
            )}
          </div>
          <span
            className={styles.memberCount}
            title={`${members.length} joined`}
          >
            👥 {members.length}
          </span>
          {isOwner && !isArchived && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onLiveTransition(activity, activity.isLive ? "end" : "start");
              }}
              disabled={Boolean(transitioningId)}
              className={cx(
                "ui-pillButton",
                styles.liveToggle,
                activity.isLive ? "ui-pillDanger" : "ui-pillPrimary",
                styles.medPill,
              )}
            >
              {transitioningId === activity.id
                ? activity.isLive
                  ? "Ending…"
                  : "Starting…"
                : activity.isLive
                  ? "End"
                  : "Start"}
            </button>
          )}
          {!isOwner && !isArchived && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                handleToggleMember(activity, isMember);
              }}
              disabled={joiningId === activity.id}
              className={cx(
                "ui-pillButton",
                styles.membershipButton,
                isMember ? "ui-pillSecondary" : "ui-pillPrimary",
                styles.medPill,
              )}
            >
              {isMember ? "Leave" : "Join"}
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
            <div className={styles.panel}>
              <p className={styles.panelTitle}>Who’s in</p>
              <div className={styles.memberList}>
                {members.map((name) => (
                  <span key={name} className={styles.memberPill}>
                    {name}
                  </span>
                ))}
              </div>

              <FeedComments
                comments={comments}
                commentText={commentText}
                onCommentTextChange={setCommentText}
                onSubmitComment={(event) => handleComment(event, activity)}
                roommates={roommates}
                user={user}
                commenting={commentingId === activity.id}
                likingCommentIds={likingCommentIds}
                onToggleLike={(comment) => handleCommentLike(activity, comment)}
                openLikesCommentId={openLikesCommentId}
                onOpenLikesChange={setOpenLikesCommentId}
                open={expanded}
                readOnly={isArchived}
              />

              <div
                className={styles.deleteActions}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
                {isArchived && (
                  <span className={styles.deletePrompt}>
                    {activity.isArchived ? "Archived event" : "Expired event"}
                  </span>
                )}
                <div className={styles.actionButtonRow}>
                  {isArchived ? (
                    <button
                      type="button"
                      onClick={() => handleRestore(activity)}
                      disabled={Boolean(restoringId || deletingId)}
                      className={cx(
                        "ui-pillButton ui-pillSecondary",
                        styles.smallPill,
                      )}
                    >
                      {restoringId === activity.id ? "Restoring…" : "Restore"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleArchive(activity)}
                      disabled={Boolean(archivingId || deletingId)}
                      className={cx(
                        "ui-pillButton ui-pillSecondary",
                        styles.smallPill,
                      )}
                    >
                      {archivingId === activity.id ? "Archiving…" : "Archive"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDelete(activity)}
                    disabled={Boolean(
                      (isArchived ? restoringId : archivingId) ||
                      deletingId ||
                      activity.isLive,
                    )}
                    className={cx(
                      "ui-pillButton ui-pillDanger",
                      styles.smallPill,
                    )}
                  >
                    {deletingId === activity.id ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <section className={styles.section}>
      {error && <p className={cx("ui-errorText", styles.error)}>{error}</p>}

      <div className={styles.list}>
        {activities.length === 0 ? (
          <p className={styles.empty}>No current activities.</p>
        ) : (
          activities.map(renderActivity)
        )}
      </div>
    </section>
  );
}
