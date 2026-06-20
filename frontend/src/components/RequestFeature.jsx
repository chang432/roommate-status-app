import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import {
  commentOnRequest,
  completeRequest,
  createRequest,
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

function RoommateChecklist({ roommates, selectedIds, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const allSelected =
    roommates.length > 0 && selectedIds.length === roommates.length;
  const selectedNames = roommates
    .filter((roommate) => selectedIds.includes(roommate.id))
    .map((roommate) => roommate.name);

  function toggleAll() {
    onChange(allSelected ? [] : roommates.map((roommate) => roommate.id));
  }

  function toggleOne(id) {
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((selectedId) => selectedId !== id)
        : [...selectedIds, id],
    );
  }

  return (
    <div
      className={styles.recipientSelect}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        className={cx("ui-textInput", styles.recipientButton)}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <span className={styles.recipientButtonText}>
          {selectedNames.length ? selectedNames.join(", ") : "Choose roommates"}
        </span>
        <span className={styles.recipientArrow}>▾</span>
      </button>
      {open && (
        <div className={styles.recipientMenu}>
          <label className={styles.recipientOption}>
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              className={styles.checkbox}
            />
            <span>All roommates</span>
          </label>
          {roommates.map((roommate) => (
            <label key={roommate.id} className={styles.recipientOption}>
              <input
                type="checkbox"
                checked={selectedIds.includes(roommate.id)}
                onChange={() => toggleOne(roommate.id)}
                className={styles.checkbox}
              />
              <span>{roommate.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export default function RequestFeature({
  requests,
  onRequestsChange,
  roommates,
  requestFocusRequest,
}) {
  const { user } = useAuth();
  const requestRefs = useRef(new Map());
  const requestableRoommates = useMemo(
    () => roommates.filter((roommate) => roommate.id !== user.id),
    [roommates, user.id],
  );
  const [text, setText] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [sending, setSending] = useState(false);
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

  async function handleSubmit(event) {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || selectedIds.length === 0 || sending) return;
    setSending(true);
    setError("");
    try {
      const updated = await createRequest(trimmed, user.id, selectedIds);
      onRequestsChange(updated);
      setText("");
      setSelectedIds([]);
    } catch {
      setError("Could not send your request. Try again.");
    } finally {
      setSending(false);
    }
  }

  async function handleResponse(requestItem, response) {
    console.log(requestItem, response);
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
      <form onSubmit={handleSubmit} className={styles.form}>
        <input
          type="text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={280}
          placeholder="Can someone bring in the bins?"
          className={cx("ui-textInput", styles.input)}
        />
        <RoommateChecklist
          roommates={requestableRoommates}
          selectedIds={selectedIds}
          onChange={setSelectedIds}
          disabled={sending}
        />
        <button
          type="submit"
          disabled={sending || !text.trim() || selectedIds.length === 0}
          className={cx("ui-primaryButton", styles.sendButton)}
        >
          {sending ? "Sending…" : "Request"}
        </button>
      </form>

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
                    <p className={styles.requestText}>{requestItem.text}</p>
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
                          requestedSelf.response === "accepted" ||
                            requestedSelf.response === "pending"
                            ? styles.acceptedAction
                            : styles.acceptAction,
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
                          requestedSelf.response === "denied" ||
                            requestedSelf.response === "pending"
                            ? styles.deniedAction
                            : styles.denyAction,
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
                              RESPONSE_CLASS[person.response] ??
                                styles.responsePending,
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
