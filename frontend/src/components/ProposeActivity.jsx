import { useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import {
  archiveActivity,
  deleteActivity,
  joinActivity,
  leaveActivity,
  commentOnActivity,
  restoreActivity,
  setCommentLiked,
  updateActivitySchedule,
} from "../api/client.js";
import FeedComments from "./FeedComments.jsx";
import SwipeActionRow from "./SwipeActionRow.jsx";
import {
  activityTimeLabel,
  fromDateTimeLocal,
  relativeTime,
  toDateTimeLocal,
} from "../utils/time.js";
import { cx } from "../utils/classNames.js";
import styles from "./styling/ProposeActivity.module.css";

export default function ProposeActivity({
  activities,
  onActivitiesChange,
  transitioningId,
  onLiveTransition,
  roommates,
  activityFocusRequest,
  moduleTag,
}) {
  const { user } = useAuth();
  const activityRefs = useRef(new Map());
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
  const [editingScheduleId, setEditingScheduleId] = useState(null);
  const [editStartTime, setEditStartTime] = useState("");
  const [editEndTime, setEditEndTime] = useState("");
  const [savingScheduleId, setSavingScheduleId] = useState(null);

  useEffect(() => {
    if (!activityFocusRequest?.activityId) return;
    const { activityId } = activityFocusRequest;
    setExpandedId(activityId);
    setCommentText("");
    requestAnimationFrame(() => {
      activityRefs.current.get(activityId)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
  }, [activityFocusRequest]);

  function toggleExpanded(id) {
    setExpandedId((current) => (current === id ? null : id));
    setCommentText("");
    setOpenLikesCommentId(null);
    setEditingScheduleId(null);
  }

  function validateTimes(startValue, endValue) {
    if (endValue && !startValue) return "Choose a start time before an end time.";
    if (
      startValue &&
      endValue &&
      fromDateTimeLocal(endValue) <= fromDateTimeLocal(startValue)
    ) {
      return "End time must be later than start time.";
    }
    return "";
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
        await setCommentLiked(
          activity.id,
          comment.id,
          user.id,
          !liked,
        ),
      );
    } catch (err) {
      setError(err.message || "Could not update the comment like. Try again.");
    } finally {
      setLikingCommentIds((current) =>
        current.filter((id) => id !== comment.id),
      );
    }
  }

  function beginScheduleEdit(activity) {
    setEditingScheduleId(activity.id);
    setEditStartTime(toDateTimeLocal(activity.startAt));
    setEditEndTime(toDateTimeLocal(activity.endAt));
  }

  async function handleScheduleSave(activity) {
    const timeError = validateTimes(editStartTime, editEndTime);
    if (timeError) {
      setError(timeError);
      return;
    }
    setSavingScheduleId(activity.id);
    setError("");
    try {
      onActivitiesChange(
        await updateActivitySchedule(
          activity.id,
          user.id,
          fromDateTimeLocal(editStartTime),
          fromDateTimeLocal(editEndTime),
        ),
      );
      setEditingScheduleId(null);
    } catch (err) {
      setError(err.message || "Could not update the schedule. Try again.");
    } finally {
      setSavingScheduleId(null);
    }
  }

  function renderActivity(activity) {
    const members = activity.members ?? [];
    const comments = activity.comments ?? [];
    const isMember = (activity.memberIds ?? []).includes(user.id);
    const isOwner = activity.proposedById === user.id;
    const expanded = expandedId === activity.id;
    const scheduleLabel = activityTimeLabel(activity);
    const editingSchedule = editingScheduleId === activity.id;
    const isArchived = Boolean(activity.isArchived || activity.isExpired);
    const swipeActions = isArchived
      ? [
          {
            label: restoringId === activity.id ? "Restoring…" : "Restore",
            pendingLabel: restoringId === activity.id ? "Restoring…" : "Restore",
            disabled: Boolean(restoringId || deletingId),
            onClick: () => handleRestore(activity),
          },
          {
            label: deletingId === activity.id ? "Deleting…" : "Delete",
            pendingLabel: deletingId === activity.id ? "Deleting…" : "Delete",
            tone: "danger",
            disabled: Boolean(restoringId || deletingId || activity.isLive),
            onClick: () => handleDelete(activity),
          },
        ]
      : [
          {
            label: archivingId === activity.id ? "Archiving…" : "Archive",
            pendingLabel: archivingId === activity.id ? "Archiving…" : "Archive",
            disabled: Boolean(archivingId || deletingId),
            onClick: () => handleArchive(activity),
          },
          {
            label: deletingId === activity.id ? "Deleting…" : "Delete",
            pendingLabel: deletingId === activity.id ? "Deleting…" : "Delete",
            tone: "danger",
            disabled: Boolean(archivingId || deletingId || activity.isLive),
            onClick: () => handleDelete(activity),
          },
        ];
    return (
      <SwipeActionRow key={activity.id} actions={swipeActions} disabled={expanded}>
        <div
          ref={(node) => {
            if (node) activityRefs.current.set(activity.id, node);
            else activityRefs.current.delete(activity.id);
          }}
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
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
        <div className={styles.summary}>
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
          <span className={styles.memberCount} title={`${members.length} joined`}>
            👥 {members.length}
          </span>
          {isOwner && !activity.isArchived && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onLiveTransition(
                  activity,
                  activity.isLive ? "end" : "start",
                );
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
                  : isArchived
                    ? "Restart"
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

              {isOwner && !activity.isLive && !isArchived && (
                <div
                  className={styles.schedulePanel}
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <div className={styles.scheduleHeader}>
                    <p className={styles.panelTitle}>Schedule</p>
                    {!editingSchedule && (
                      <button
                        type="button"
                        onClick={() => beginScheduleEdit(activity)}
                        className={cx(
                          "ui-pillButton ui-pillSecondary",
                          styles.smallPill,
                        )}
                      >
                        Edit
                      </button>
                    )}
                  </div>
                  {editingSchedule ? (
                    <>
                      <div className={styles.timeFields}>
                        <label className={styles.timeField}>
                          <span>Start</span>
                          <input
                            type="datetime-local"
                            value={editStartTime}
                            onChange={(event) => {
                              setEditStartTime(event.target.value)
                              if (!event.target.value) setEditEndTime("")
                            }}
                            className={cx("ui-textInput", styles.timeInput)}
                          />
                        </label>
                        <label className={styles.timeField}>
                          <span>End (optional)</span>
                          <input
                            type="datetime-local"
                            value={editEndTime}
                            onChange={(event) =>
                              setEditEndTime(event.target.value)
                            }
                            disabled={!editStartTime}
                            className={cx("ui-textInput", styles.timeInput)}
                          />
                        </label>
                      </div>
                      <div className={styles.scheduleActions}>
                        <button
                          type="button"
                          onClick={() => setEditingScheduleId(null)}
                          className={cx(
                            "ui-pillButton ui-pillSecondary",
                            styles.smallPill,
                          )}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => handleScheduleSave(activity)}
                          disabled={savingScheduleId === activity.id}
                          className={cx(
                            "ui-pillButton ui-pillPrimary",
                            styles.smallPill,
                          )}
                        >
                          {savingScheduleId === activity.id ? "Saving…" : "Save"}
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className={styles.scheduleValue}>
                      {scheduleLabel || "No start time"}
                    </p>
                  )}
                </div>
              )}

              <FeedComments
                comments={comments}
                commentText={commentText}
                onCommentTextChange={setCommentText}
                onSubmitComment={(event) => handleComment(event, activity)}
                roommates={roommates}
                user={user}
                commenting={commentingId === activity.id}
                likingCommentIds={likingCommentIds}
                onToggleLike={(comment) =>
                  handleCommentLike(activity, comment)
                }
                openLikesCommentId={openLikesCommentId}
                onOpenLikesChange={setOpenLikesCommentId}
                readOnly={isArchived}
              />
            </div>
          </div>
        </div>
        </div>
      </SwipeActionRow>
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
