import { useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import {
  archiveRequest,
  commentOnRequest,
  deleteRequest,
  respondToRequest,
  restoreRequest,
  setRequestCommentLiked,
} from "../api/client.js";
import FeedComments from "./FeedComments.jsx";
import SwipeActionRow from "./SwipeActionRow.jsx";
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
  const [archivingId, setArchivingId] = useState(null);
  const [restoringId, setRestoringId] = useState(null);
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

  async function handleArchive(requestItem) {
    if (archivingId || requestItem.isArchived) return;
    setArchivingId(requestItem.id);
    setError("");
    try {
      onRequestsChange(await archiveRequest(requestItem.id, user.id));
    } catch {
      setError("Could not archive the request. Try again.");
    } finally {
      setArchivingId(null);
    }
  }

  async function handleRestore(requestItem) {
    if (restoringId || !requestItem.isArchived) return;
    setRestoringId(requestItem.id);
    setError("");
    try {
      onRequestsChange(await restoreRequest(requestItem.id, user.id));
    } catch {
      setError("Could not restore the request. Try again.");
    } finally {
      setRestoringId(null);
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
            const isArchived = requestItem.isArchived;
            const showRequesterIcons = !isArchived;
            const swipeActions = isArchived
              ? [
                  {
                    label: restoringId === requestItem.id ? "Restoring…" : "Restore",
                    pendingLabel: restoringId === requestItem.id ? "Restoring…" : "Restore",
                    disabled: Boolean(restoringId || deletingId),
                    onClick: () => handleRestore(requestItem),
                  },
                  {
                    label: deletingId === requestItem.id ? "Deleting…" : "Delete",
                    pendingLabel: deletingId === requestItem.id ? "Deleting…" : "Delete",
                    tone: "danger",
                    disabled: Boolean(restoringId || deletingId),
                    onClick: () => handleDelete(requestItem),
                  },
                ]
              : [
                  {
                    label: archivingId === requestItem.id ? "Archiving…" : "Archive",
                    pendingLabel: archivingId === requestItem.id ? "Archiving…" : "Archive",
                    disabled: Boolean(archivingId || deletingId),
                    onClick: () => handleArchive(requestItem),
                  },
                  {
                    label: deletingId === requestItem.id ? "Deleting…" : "Delete",
                    pendingLabel: deletingId === requestItem.id ? "Deleting…" : "Delete",
                    tone: "danger",
                    disabled: Boolean(archivingId || deletingId),
                    onClick: () => handleDelete(requestItem),
                  },
                ];
            return (
              <SwipeActionRow key={requestItem.id} actions={swipeActions}>
                <div
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
                    isArchived ? styles.completedCard : "",
                  )}
                >
                  <div className={styles.summary}>
                    <div className={styles.summaryText}>
                      <div className={styles.titleRow}>
                        {moduleTag}
                        <p className={styles.requestText}>{requestItem.text}</p>
                      </div>
                      <p className={styles.meta}>
                        {requestItem.requester} ·{" "}
                        {relativeTime(requestItem.createdAt)}
                      </p>
                    </div>
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
                    {requestedSelf && !isArchived && (
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
                                isArchived ? styles.completedResponsePill : "",
                                isArchived
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
                          readOnly={isArchived}
                        />

                        {isArchived ? (
                          <div className={styles.requestActions}>
                            <span className={styles.completedText}>
                              Archived{requestItem.archivedBy ? ` by ${requestItem.archivedBy}` : ""}
                            </span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              </SwipeActionRow>
            );
          })
        )}
      </div>
    </div>
  );
}
