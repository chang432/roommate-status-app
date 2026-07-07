import { useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import {
  commentOnRequest,
  completeRequest,
  deleteRequest,
  reopenRequest,
  respondToRequest,
  setRequestCommentLiked,
} from "../api/client.js";
import FeedComments from "./FeedComments.jsx";
import { relativeTime } from "../utils/time.js";
import { cx } from "../utils/classNames.js";
import styles from "./styling/RequestFeature.module.css";

const RESPONSE_CLASS = {
  accepted: styles.responseAccepted,
  denied: styles.responseDenied,
  pending: styles.responsePending,
};

const RESPONSE_OUTLINE_CLASS = {
  accepted: styles.responseOutlineAccepted,
  denied: styles.responseOutlineDenied,
  pending: styles.responseOutlinePending,
};

function responseActionClass(currentResponse, action) {
  if (currentResponse !== "pending" && currentResponse !== action) {
    if (action === "accepted") return styles.mutedAcceptAction;
    else return styles.mutedDenyAction;
  }
  if (action === "accepted") return styles.acceptedAction;
  return styles.deniedAction;
}

export default function RequestFeature({
  requests,
  onRequestsChange,
  roommates,
  requestFocusRequest,
  moduleTag,
}) {
  const { user } = useAuth();
  const requestRefs = useRef(new Map());
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [commentText, setCommentText] = useState("");
  const [commentingId, setCommentingId] = useState(null);
  const [likingCommentIds, setLikingCommentIds] = useState([]);
  const [openLikesCommentId, setOpenLikesCommentId] = useState(null);
  const [respondingId, setRespondingId] = useState(null);
  const [completingId, setCompletingId] = useState(null);
  const [reopeningId, setReopeningId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    if (!requestFocusRequest?.requestId) return;
    const requestExists = requests.some(
      (requestItem) => requestItem.id === requestFocusRequest.requestId,
    );
    if (!requestExists) return;
    setExpandedId(requestFocusRequest.requestId);
    setCommentText("");
    setOpenLikesCommentId(null);
    window.requestAnimationFrame(() => {
      requestRefs.current
        .get(requestFocusRequest.requestId)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [requestFocusRequest, requests]);

  function toggleExpanded(id) {
    setExpandedId((current) => (current === id ? null : id));
    setCommentText("");
    setOpenLikesCommentId(null);
  }

  async function handleResponse(requestItem, response) {
    if (respondingId) return;
    setRespondingId(requestItem.id);
    setError("");
    try {
      onRequestsChange(
        await respondToRequest(requestItem.id, user.id, response),
      );
    } catch {
      setError("Could not update your response. Try again.");
    } finally {
      setRespondingId(null);
    }
  }

  async function handleComplete(requestItem) {
    if (completingId || requestItem.isCompleted) return;
    setCompletingId(requestItem.id);
    setError("");
    try {
      onRequestsChange(await completeRequest(requestItem.id, user.id));
    } catch {
      setError("Could not complete the request. Try again.");
    } finally {
      setCompletingId(null);
    }
  }

  async function handleReopen(requestItem) {
    if (reopeningId || !requestItem.isCompleted) return;
    setReopeningId(requestItem.id);
    setError("");
    try {
      onRequestsChange(await reopenRequest(requestItem.id, user.id));
    } catch {
      setError("Could not reopen the request. Try again.");
    } finally {
      setReopeningId(null);
    }
  }

  async function handleDelete(requestItem) {
    if (deletingId) return;
    setDeletingId(requestItem.id);
    setError("");
    try {
      onRequestsChange(await deleteRequest(requestItem.id, user.id));
      setExpandedId((current) => (current === requestItem.id ? null : current));
    } catch {
      setError("Could not delete the request. Try again.");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleComment(event, requestItem) {
    event.preventDefault();
    const trimmed = commentText.trim();
    if (!trimmed || commentingId) return;
    setCommentingId(requestItem.id);
    setError("");
    try {
      onRequestsChange(
        await commentOnRequest(requestItem.id, user.id, trimmed),
      );
      setCommentText("");
    } catch {
      setError("Could not post your comment. Try again.");
    } finally {
      setCommentingId(null);
    }
  }

  async function handleCommentLike(requestItem, comment) {
    if (likingCommentIds.includes(comment.id)) return;
    setLikingCommentIds((current) => [...current, comment.id]);
    setError("");
    try {
      const liked = (comment.likedByIds ?? []).includes(user.id);
      onRequestsChange(
        await setRequestCommentLiked(
          requestItem.id,
          comment.id,
          user.id,
          !liked,
        ),
      );
    } catch {
      setError("Could not update the comment like. Try again.");
    } finally {
      setLikingCommentIds((current) =>
        current.filter((id) => id !== comment.id),
      );
    }
  }

  return (
    <div className={styles.wrap}>
      {error && <p className={cx("ui-errorText", styles.error)}>{error}</p>}

      <div className={styles.list}>
        {requests.length === 0 ? (
          <p className={styles.empty}>No requests yet.</p>
        ) : (
          requests.map((requestItem) => {
            const expanded = expandedId === requestItem.id;
            const requestedSelf = requestItem.requested.find(
              (person) => person.id === user.id,
            );
            const canDelete = requestItem.requesterId === user.id;
            const showRequesterIcons = canDelete && !requestItem.isCompleted;
            return (
              <div
                key={requestItem.id}
                ref={(node) => {
                  if (node) {
                    requestRefs.current.set(requestItem.id, node);
                  } else {
                    requestRefs.current.delete(requestItem.id);
                  }
                }}
                role="button"
                tabIndex={0}
                aria-expanded={expanded}
                onClick={() => toggleExpanded(requestItem.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    toggleExpanded(requestItem.id);
                  }
                }}
                className={cx(
                  styles.card,
                  requestItem.isCompleted ? styles.completedCard : "",
                )}
              >
                <div className={styles.summary}>
                  <div className={styles.summaryText}>
                    <div className={styles.titleRow}>
                      <p className={styles.requestText}>{requestItem.text}</p>
                      {moduleTag}
                    </div>
                    <p className={styles.meta}>
                      {requestItem.requester} ·{" "}
                      {relativeTime(requestItem.createdAt)}
                    </p>
                  </div>
                  {requestItem.isCompleted && (
                    <div
                      className={styles.summaryActions}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <button
                        type="button"
                        disabled={reopeningId === requestItem.id}
                        onClick={() => handleReopen(requestItem)}
                        className={cx(
                          "ui-pillButton ui-pillSecondary",
                          styles.summaryReopen,
                        )}
                      >
                        {reopeningId === requestItem.id
                          ? "Reopening…"
                          : "Reopen"}
                      </button>
                    </div>
                  )}
                  {showRequesterIcons && (
                    <div className={styles.responseIcons}>
                      {requestItem.requested.map((person) => (
                        <span
                          key={person.id}
                          className={cx(
                            styles.responseIcon,
                            RESPONSE_CLASS[person.response] ??
                              styles.responsePending,
                          )}
                          title={`${person.name}: ${person.response}`}
                        >
                          {person.name.slice(0, 1)}
                        </span>
                      ))}
                    </div>
                  )}
                  {requestedSelf && !requestItem.isCompleted && !canDelete && (
                    <div
                      className={styles.summaryActions}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <button
                        type="button"
                        disabled={respondingId === requestItem.id}
                        onClick={() => handleResponse(requestItem, "accepted")}
                        className={cx(
                          styles.iconAction,
                          responseActionClass(
                            requestedSelf.response,
                            "accepted",
                          ),
                        )}
                        aria-label="Accept request"
                        title="Accept"
                      >
                        ✓
                      </button>
                      <button
                        type="button"
                        disabled={respondingId === requestItem.id}
                        onClick={() => handleResponse(requestItem, "denied")}
                        className={cx(
                          styles.iconAction,
                          responseActionClass(requestedSelf.response, "denied"),
                        )}
                        aria-label="Deny request"
                        title="Deny"
                      >
                        ×
                      </button>
                    </div>
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
                      <p className={styles.panelTitle}>Responses</p>
                      <div className={styles.responseList}>
                        {requestItem.requested.map((person) => (
                          <span
                            key={person.id}
                            className={cx(
                              styles.responsePill,
                              requestItem.isCompleted
                                ? styles.completedResponsePill
                                : "",
                              requestItem.isCompleted
                                ? (RESPONSE_OUTLINE_CLASS[person.response] ??
                                    styles.responseOutlinePending)
                                : (RESPONSE_CLASS[person.response] ??
                                    styles.responsePending),
                            )}
                          >
                            {person.name}
                          </span>
                        ))}
                      </div>

                      <FeedComments
                        comments={requestItem.comments ?? []}
                        commentText={commentText}
                        onCommentTextChange={setCommentText}
                        onSubmitComment={(event) =>
                          handleComment(event, requestItem)
                        }
                        roommates={roommates}
                        user={user}
                        commenting={commentingId === requestItem.id}
                        likingCommentIds={likingCommentIds}
                        onToggleLike={(comment) =>
                          handleCommentLike(requestItem, comment)
                        }
                        openLikesCommentId={openLikesCommentId}
                        onOpenLikesChange={setOpenLikesCommentId}
                      />

                      <div
                        className={styles.requestActions}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        {requestItem.isCompleted ? (
                          <span className={styles.completedText}>
                            Completed by {requestItem.completedBy}
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={completingId === requestItem.id}
                            onClick={() => handleComplete(requestItem)}
                            className={cx(
                              "ui-pillButton ui-pillSecondary",
                              styles.requestActionButton,
                            )}
                          >
                            {completingId === requestItem.id
                              ? "Completing…"
                              : "Completed"}
                          </button>
                        )}
                        {!requestItem.isCompleted && canDelete && (
                          <button
                            type="button"
                            disabled={deletingId === requestItem.id}
                            onClick={() => handleDelete(requestItem)}
                            className={cx(
                              "ui-pillButton ui-pillDangerSoft",
                              styles.requestActionButton,
                            )}
                          >
                            {deletingId === requestItem.id
                              ? "Deleting…"
                              : "Delete"}
                          </button>
                        )}
                      </div>
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
