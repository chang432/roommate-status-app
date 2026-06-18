import { useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import {
  proposeActivity,
  deleteActivity,
  notifyActivity,
  joinActivity,
  leaveActivity,
  commentOnActivity,
  setCommentLiked,
} from "../api/client.js";
import { cx } from "../utils/classNames.js";
import CommentComposer from "./CommentComposer.jsx";
import CommentLikeButton from "./CommentLikeButton.jsx";
import MentionText from "./MentionText.jsx";
import { relativeTime } from "../utils/time.js";

const COLLAPSED_COMMENT_LIMIT = 10;

// "Propose an activity": a text field + Send button that pushes the proposal to
// everyone, with the most recent proposals listed below (newest nearest the
// input).
export default function ProposeActivity({
  activities,
  onActivitiesChange,
  liveEvent,
  transitioningId,
  onLiveTransition,
  roommates,
  activityFocusRequest,
}) {
  const { user } = useAuth();
  const activityRefs = useRef(new Map());
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  // Per-activity notify state: the id currently sending, and the id just sent
  // (briefly shown as a confirmation).
  const [notifyingId, setNotifyingId] = useState(null);
  const [sentId, setSentId] = useState(null);
  // The id of the activity whose member panel is expanded, and the id whose
  // join/leave request is currently in flight (to disable its button).
  const [expandedId, setExpandedId] = useState(null);
  const [joiningId, setJoiningId] = useState(null);
  // The comment draft for the currently expanded activity, and the id whose
  // comment is currently being posted (only one panel is open at a time, so a
  // single draft string is enough — it's cleared whenever the panel changes).
  const [commentText, setCommentText] = useState("");
  const [commentingId, setCommentingId] = useState(null);
  const [likingCommentIds, setLikingCommentIds] = useState([]);
  const [showOlderComments, setShowOlderComments] = useState(false);
  // Deletion is owner-only and uses a two-step inline confirmation.
  const [confirmingDeleteId, setConfirmingDeleteId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const commentScrollerRef = useRef(null);

  useEffect(() => {
    if (!activityFocusRequest?.activityId) return;
    const { activityId } = activityFocusRequest;
    setExpandedId(activityId);
    setCommentText("");
    setConfirmingDeleteId(null);

    requestAnimationFrame(() => {
      activityRefs.current.get(activityId)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
  }, [activityFocusRequest]);

  // Open/close an activity's panel, clearing any half-typed comment so a draft
  // never bleeds from one activity's panel into another's.
  function toggleExpanded(id) {
    setExpandedId((cur) => (cur === id ? null : id));
    setCommentText("");
    setConfirmingDeleteId(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError("");
    try {
      const updated = await proposeActivity(trimmed, user.id);
      onActivitiesChange(updated);
      setText("");
    } catch {
      setError("Could not send your proposal. Try again.");
    } finally {
      setSending(false);
    }
  }

  async function handleDelete(activity) {
    if (deletingId) return;
    setDeletingId(activity.id);
    setError("");
    try {
      const updated = await deleteActivity(activity.id, user.id);
      onActivitiesChange(updated);
      setConfirmingDeleteId(null);
      setExpandedId((current) => (current === activity.id ? null : current));
    } catch {
      setError("Could not delete the activity. Try again.");
    } finally {
      setDeletingId(null);
    }
  }

  // Notify the other participants that you emphasized this activity.
  async function handleNotify(activity) {
    if (notifyingId) return;
    setNotifyingId(activity.id);
    setError("");
    try {
      await notifyActivity(activity.id, user.id);
      setSentId(activity.id);
      setTimeout(
        () => setSentId((cur) => (cur === activity.id ? null : cur)),
        2000,
      );
    } catch {
      setError("Could not send the notification. Try again.");
    } finally {
      setNotifyingId(null);
    }
  }

  // Toggle the current user's membership of an activity. The member list comes
  // back from the server, so the count and panel stay in sync everywhere.
  async function handleToggleMember(activity, isMember) {
    if (joiningId) return;
    setJoiningId(activity.id);
    setError("");
    try {
      const updated = isMember
        ? await leaveActivity(activity.id, user.id)
        : await joinActivity(activity.id, user.id);
      onActivitiesChange(updated);
    } catch {
      setError(
        `Could not ${isMember ? "leave" : "join"} the activity. Try again.`,
      );
    } finally {
      setJoiningId(null);
    }
  }

  // Post the current draft as a comment on `activity`. The server returns the
  // refreshed feed (with the new comment), so counts and lists stay in sync.
  async function handleComment(e, activity) {
    e.preventDefault();
    const trimmed = commentText.trim();
    if (!trimmed || commentingId) return;
    setCommentingId(activity.id);
    setError("");
    try {
      const updated = await commentOnActivity(activity.id, user.id, trimmed);
      onActivitiesChange(updated);
      setCommentText("");
    } catch {
      setError("Could not post your comment. Try again.");
    } finally {
      setCommentingId(null);
    }
  }

  // Scroll the comment scroller to the bottom when new comments are added.
  useEffect(() => {
    if (commentScrollerRef.current) {
      commentScrollerRef.current.scrollTop =
        commentScrollerRef.current.scrollHeight;
    }
  }, [activities]);

  async function handleCommentLike(activity, comment) {
    if (likingCommentIds.includes(comment.id)) return;
    setLikingCommentIds((current) => [...current, comment.id]);
    setError("");
    try {
      const liked = (comment.likedByIds ?? []).includes(user.id);
      const updated = await setCommentLiked(
        activity.id,
        comment.id,
        user.id,
        !liked,
      );
      onActivitiesChange(updated);
    } catch {
      setError("Could not update the comment like. Try again.");
    } finally {
      setLikingCommentIds((current) =>
        current.filter((id) => id !== comment.id),
      );
    }
  }

  return (
    <section className={styles.section}>
      <p className="ui-sectionLabel">Propose an activity</p>

      <form onSubmit={handleSubmit} className={styles.form}>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={280}
          placeholder="Pizza and a movie?"
          className={cx("ui-textInput", styles.input)}
        />
        <button
          type="submit"
          disabled={sending || !text.trim()}
          className={cx("ui-primaryButton", styles.sendButton)}
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </form>

      {error && <p className={cx("ui-errorText", styles.error)}>{error}</p>}

      <div className={styles.list}>
        {activities.length === 0 ? (
          <p className={styles.empty}>
            No activities yet — propose the first one!
          </p>
        ) : (
          activities.map((a) => {
            const members = a.members ?? [];
            const comments = a.comments ?? [];
            const isMember = (a.memberIds ?? []).includes(user.id);
            // The proposer is permanently part of their own activity, so they
            // get no Join/Leave button.
            const canDelete = a.proposedById === user.id;
            const expanded = expandedId === a.id;
            return (
              <div
                key={a.id}
                ref={(node) => {
                  if (node) {
                    activityRefs.current.set(a.id, node);
                  } else {
                    activityRefs.current.delete(a.id);
                  }
                }}
                // The whole card is a toggle that expands the member panel; the
                // action buttons inside stop propagation so they don't toggle it.
                role="button"
                tabIndex={0}
                aria-expanded={expanded}
                onClick={() => toggleExpanded(a.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggleExpanded(a.id);
                  }
                }}
                className={a.isLive ? styles.activeCard : styles.card}
              >
                <div className={styles.summary}>
                  <div className={styles.summaryText}>
                    <div className={styles.titleRow}>
                      <p className={styles.activityText}>{a.text}</p>
                      {a.isLive && (
                        <span className={styles.liveChip}>Live</span>
                      )}
                    </div>
                    <p className={styles.meta}>
                      {a.proposedBy} · {relativeTime(a.createdAt)}
                    </p>
                  </div>
                  {/* Member count — at least 1 since the proposer auto-joins. */}
                  <span
                    className={styles.memberCount}
                    title={`${members.length} joined`}
                  >
                    👥 {members.length}
                  </span>
                  {canDelete && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onLiveTransition(a, a.isLive ? "end" : "start");
                      }}
                      disabled={
                        Boolean(transitioningId) ||
                        (!a.isLive && Boolean(liveEvent))
                      }
                      title={
                        !a.isLive && liveEvent
                          ? `${liveEvent.text} is already live`
                          : undefined
                      }
                      className={cx(
                        "ui-pillButton",
                        styles.liveToggle,
                        a.isLive ? "ui-pillDanger" : "ui-pillPrimary",
                      )}
                    >
                      {transitioningId === a.id
                        ? a.isLive
                          ? "Ending…"
                          : "Starting…"
                        : a.isLive
                          ? "End"
                          : "Start"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleNotify(a);
                    }}
                    disabled={notifyingId === a.id}
                    // Icon-only: text is dropped in favor of the bell; aria-label
                    // keeps it accessible, and a ✓ briefly confirms a sent notify.
                    aria-label="Notify participants"
                    className={cx("ui-pillButton", styles.notifyButton)}
                  >
                    {sentId === a.id ? "✓" : "🔔"}
                  </button>
                  {!canDelete && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleMember(a, isMember);
                      }}
                      disabled={joiningId === a.id}
                      className={cx(
                        "ui-pillButton",
                        styles.membershipButton,
                        isMember ? "ui-pillSecondary" : "ui-pillPrimary",
                      )}
                    >
                      {isMember ? "Leave" : "Join"}
                    </button>
                  )}
                </div>

                {/* Expandable panel. Kept mounted (not conditionally rendered)
                    so its height can animate via the grid 0fr→1fr trick, which
                    slides smoothly to the content's natural height with no magic
                    max-height. `inert` while collapsed keeps the hidden controls
                    out of the tab order and unclickable. */}
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
                      {members.length === 0 ? (
                        <p className={styles.emptyPanelText}>No one yet.</p>
                      ) : (
                        <div className={styles.memberList}>
                          {members.map((name) => (
                            <span key={name} className={styles.memberPill}>
                              {name}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Comments — the activity's most recent messages (oldest
                          first, newest nearest the input) plus a box to add one.
                          Clicks/keys are kept inside so typing or focusing the
                          input doesn't toggle the surrounding card. */}
                      <div
                        className={styles.comments}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        <p className={styles.panelTitle}>Comments</p>
                        {comments.length === 0 ? (
                          <p className={styles.emptyComments}>
                            No comments yet.
                          </p>
                        ) : (
                          <div
                            className={styles.commentScroller}
                            ref={commentScrollerRef}
                          >
                            <ul className={styles.commentList}>
                              {comments.map((c, i) => (
                                <li
                                  key={c.id ?? `${c.createdAt}-${i}`}
                                  className="text-[13px]"
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="font-bold text-ink">
                                      {c.author}
                                    </span>
                                    <span className="text-[11px] text-ink-soft">
                                      {relativeTime(c.createdAt)}
                                    </span>
                                    <CommentLikeButton
                                      count={c.likeCount ?? 0}
                                      liked={(c.likedByIds ?? []).includes(
                                        user.id,
                                      )}
                                      ownComment={
                                        c.authorId === user.id ||
                                        (!c.authorId &&
                                          c.author.toLowerCase() ===
                                            user.name.toLowerCase())
                                      }
                                      busy={likingCommentIds.includes(c.id)}
                                      onToggle={() => handleCommentLike(a, c)}
                                    />
                                  </div>
                                  <p className="text-ink">
                                    <MentionText
                                      text={c.text}
                                      mentions={c.mentions}
                                      mentionsAll={c.mentionsAll}
                                    />
                                  </p>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        <CommentComposer
                          value={commentText}
                          onChange={setCommentText}
                          onSubmit={(event) => handleComment(event, a)}
                          roommates={roommates}
                          currentUserId={user.id}
                          busy={commentingId === a.id}
                        />
                      </div>

                      {canDelete && (
                        <div
                          className={styles.deleteActions}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          {confirmingDeleteId === a.id ? (
                            <>
                              <span className={styles.deletePrompt}>
                                Delete this event?
                              </span>
                              <button
                                type="button"
                                onClick={() => setConfirmingDeleteId(null)}
                                disabled={deletingId === a.id}
                                className={cx(
                                  "ui-pillButton ui-pillSecondary",
                                  styles.smallPill,
                                )}
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDelete(a)}
                                disabled={deletingId === a.id || a.isLive}
                                title={
                                  a.isLive
                                    ? "End the event before deleting it"
                                    : undefined
                                }
                                className={cx(
                                  "ui-pillButton ui-pillDanger",
                                  styles.smallPill,
                                )}
                              >
                                {deletingId === a.id ? "Deleting…" : "Delete"}
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmingDeleteId(a.id)}
                              disabled={a.isLive}
                              title={
                                a.isLive
                                  ? "End the event before deleting it"
                                  : undefined
                              }
                              className={cx(
                                "ui-pillButton ui-pillDangerSoft",
                                styles.smallPill,
                              )}
                            >
                              Delete event
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
