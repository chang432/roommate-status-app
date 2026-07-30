import { useState } from "react";
import { useAuth } from "../../context/AuthContext.jsx";
import { useExpandOnModuleFocus } from "../../context/ModuleFocusContext.jsx";
import {
  archiveRequest,
  commentOnRequest,
  deleteRequest,
  respondToRequest,
  restoreRequest,
  setRequestCommentLiked,
} from "../../api/requests.js";
import FeedComments from "../comments/FeedComments.jsx";
import { useConfirmDialog } from "../ui/useConfirmDialog.jsx";
import ModuleEditButton from "./ModuleEditButton.jsx";
import { relativeTime } from "../../utils/time.js";
import { cx } from "../../utils/classNames.js";
import styles from "./RequestFeature.module.css";

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
  moduleTag,
  onEdit,
}) {
  const { user } = useAuth();
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
  const { confirm, confirmationDialog } = useConfirmDialog();
  useExpandOnModuleFocus(setExpandedId);

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
    const confirmed = await confirm({
      title: `Delete ${requestItem.text}?`,
      message: "This permanently removes the request, responses, and comments.",
      confirmLabel: "Delete request",
    });
    if (!confirmed) return;
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
            return (
              <div
                key={requestItem.id}
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
                          open={expanded}
                          readOnly={isArchived}
                        />

                        <div
                          className="ui-moduleActionRow"
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => event.stopPropagation()}
                        >
                          <span className={styles.completedText}>
                            {isArchived
                              ? `Archived${requestItem.archivedBy ? ` by ${requestItem.archivedBy}` : ""}`
                              : "Request actions"}
                          </span>
                          <ModuleEditButton
                            onEdit={onEdit}
                            disabled={Boolean(
                              restoringId || archivingId || deletingId,
                            )}
                          />
                          {isArchived ? (
                            <button
                              type="button"
                              onClick={() => handleRestore(requestItem)}
                              disabled={Boolean(restoringId || deletingId)}
                              className="ui-pillButton ui-pillSecondary ui-moduleActionButton"
                            >
                              {restoringId === requestItem.id ? "Restoring…" : "Restore"}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleArchive(requestItem)}
                              disabled={Boolean(archivingId || deletingId)}
                              className="ui-pillButton ui-pillSecondary ui-moduleActionButton"
                            >
                              {archivingId === requestItem.id ? "Archiving…" : "Archive"}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDelete(requestItem)}
                            disabled={Boolean((isArchived ? restoringId : archivingId) || deletingId)}
                            className="ui-pillButton ui-pillDanger ui-moduleActionButton"
                          >
                            {deletingId === requestItem.id ? "Deleting…" : "Delete"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
              </div>
            );
          })
        )}
      </div>
      {confirmationDialog}
    </div>
  );
}
