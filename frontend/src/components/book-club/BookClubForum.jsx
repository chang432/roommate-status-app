import { useCallback, useEffect, useState } from "react";
import {
  createBookClubForumEntry,
  deleteBookClubForumEntry,
  getBookClubForum,
  updateBookClubForumEntry,
} from "../../api/bookClub.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { relativeTime } from "../../utils/time.js";
import { useConfirmDialog } from "../ui/useConfirmDialog.jsx";
import styles from "./BookClubForum.module.css";

export default function BookClubForum({ meeting, canAdminister, focusThreadId, variant = "card" }) {
  const { user } = useAuth();
  const [forum, setForum] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [messageBody, setMessageBody] = useState("");
  const [replyTo, setReplyTo] = useState(null);
  const [replyBody, setReplyBody] = useState("");
  const [editing, setEditing] = useState(null);
  const [collapsedEntries, setCollapsedEntries] = useState(() => new Set());
  const { confirm, confirmationDialog } = useConfirmDialog();

  const loadForum = useCallback(async () => {
    try {
      const response = await getBookClubForum(user.id, meeting.id);
      setForum(response.forum);
      setError("");
    } catch (err) {
      setError(err.message || "Could not load the meeting discussion.");
    }
  }, [meeting.id, user.id]);

  useEffect(() => {
    void loadForum();
  }, [loadForum]);

  useEffect(() => {
    if (!focusThreadId || !forum) return;
    requestAnimationFrame(() => {
      document.getElementById(`forum-${focusThreadId}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
  }, [focusThreadId, forum]);

  async function createMessage(event) {
    event.preventDefault();
    if (!messageBody.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await createBookClubForumEntry(user.id, meeting.id, {
        body: messageBody,
      });
      setForum(response.forum);
      setMessageBody("");
    } catch (err) {
      setError(err.message || "Could not send the message.");
    } finally {
      setBusy(false);
    }
  }

  async function createReply(event) {
    event.preventDefault();
    if (!replyTo || !replyBody.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await createBookClubForumEntry(user.id, meeting.id, {
        parentPostId: replyTo,
        body: replyBody,
      });
      setForum(response.forum);
      setReplyTo(null);
      setReplyBody("");
    } catch (err) {
      setError(err.message || "Could not add the reply.");
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(event) {
    event.preventDefault();
    if (!editing?.body.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await updateBookClubForumEntry(
        user.id,
        meeting.id,
        editing.id,
        { body: editing.body },
      );
      setForum(response.forum);
      setEditing(null);
    } catch (err) {
      setError(err.message || "Could not update the message.");
    } finally {
      setBusy(false);
    }
  }

  async function removeEntry(entry) {
    if (busy) return;
    const kind = entry.parentPostId ? "reply" : "message";
    const confirmed = await confirm({
      title: `Remove this ${kind}?`,
      message: `This permanently removes the ${kind} from the meeting discussion.`,
      confirmLabel: `Remove ${kind}`,
    });
    if (!confirmed) return;
    setBusy(true);
    setError("");
    try {
      const response = await deleteBookClubForumEntry(user.id, meeting.id, entry.id);
      setForum(response.forum);
    } catch (err) {
      setError(err.message || "Could not remove the forum entry.");
    } finally {
      setBusy(false);
    }
  }

  function entryActions(entry, locked) {
    const ownsEntry = entry.authorId === user.id;
    if (locked || entry.deletedAt || (!ownsEntry && !canAdminister)) return null;
    return (
      <div className={styles.entryActions}>
        {ownsEntry && (
          <button type="button" onClick={() => setEditing({
            id: entry.id,
            body: entry.body,
            isReply: Boolean(entry.parentPostId),
          })}>Edit</button>
        )}
        <button type="button" disabled={busy} onClick={() => removeEntry(entry)}>Remove</button>
      </div>
    );
  }

  function toggleEntry(entryId) {
    setCollapsedEntries((current) => {
      const next = new Set(current);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  }

  function renderEntry(entry, locked, reply = false) {
    const isEditing = editing?.id === entry.id;
    const collapsed = collapsedEntries.has(entry.id);
    const contentId = `forum-entry-${entry.id}`;
    return (
      <article
        key={entry.id}
        id={!reply ? `forum-${entry.id}` : undefined}
        className={`${reply ? styles.reply : styles.topic} ${collapsed ? styles.collapsed : ""}`}
      >
        <header className={styles.entryHeader}>
          <button
            type="button"
            className={styles.entrySummary}
            aria-expanded={!collapsed}
            aria-controls={contentId}
            onClick={() => toggleEntry(entry.id)}
          >
            <strong>{entry.authorName}</strong>
            <span>{relativeTime(entry.createdAt)}{entry.updatedAt > entry.createdAt ? " · edited" : ""}</span>
            <span className={styles.collapseGlyph} aria-hidden="true">⌄</span>
          </button>
          {entryActions(entry, locked)}
        </header>
        <div id={contentId} className={styles.entryContent} hidden={collapsed}>
          {isEditing ? (
            <form className={styles.editForm} onSubmit={saveEdit}>
              <textarea aria-label="Discussion message" maxLength={editing.isReply ? 1000 : 2000} required value={editing.body} onChange={(event) => setEditing({ ...editing, body: event.target.value })} />
              <div>
                <button type="submit" className={`ui-primaryButton ${styles.primaryAction}`} disabled={busy}>Save</button>
                <button type="button" onClick={() => setEditing(null)}>Cancel</button>
              </div>
            </form>
          ) : entry.deletedAt ? (
            <p className={styles.deleted}>This {reply ? "reply" : "message"} was removed{entry.deletedByName ? ` by ${entry.deletedByName}` : ""}.</p>
          ) : (
            <>
              {!reply && entry.title ? <h3>{entry.title}</h3> : null}
              <p className={styles.entryBody}>{entry.body}</p>
            </>
          )}
        </div>
      </article>
    );
  }

  return (
    <section
      className={`${styles.forumPanel} ${variant === "flat" ? styles.flatForum : ""}`}
      aria-label={`${meeting.bookTitle} discussion`}
    >
      {error && <p className="ui-errorBox">{error}</p>}
      {!forum && !error && <p className={styles.forumState}>Loading discussion…</p>}
      {forum?.locked && <p className={styles.locked}>This discussion closed when the meeting was completed.</p>}
      {forum && !forum.threads.length && <p className={styles.forumState}>No messages yet. Start the conversation.</p>}
      <div className={styles.threads}>
        {forum?.threads.map((thread) => (
          <section key={thread.id} className={styles.thread}>
            {renderEntry(thread, forum.locked)}
            {!collapsedEntries.has(thread.id) && (
              <>
                <div className={styles.replies}>
                  {thread.replies.map((reply) => renderEntry(reply, forum.locked, true))}
                </div>
                {!forum.locked && !thread.deletedAt && (
                  replyTo === thread.id ? (
                    <form className={styles.replyForm} onSubmit={createReply}>
                      <textarea aria-label={`Reply to ${thread.title || "message"}`} autoFocus maxLength={1000} required value={replyBody} onChange={(event) => setReplyBody(event.target.value)} placeholder="Write a reply…" />
                      <div><button className={`ui-primaryButton ${styles.primaryAction}`} type="submit" disabled={busy || !replyBody.trim()}>Reply</button><button type="button" onClick={() => { setReplyTo(null); setReplyBody(""); }}>Cancel</button></div>
                    </form>
                  ) : <button type="button" className={styles.replyButton} onClick={() => setReplyTo(thread.id)}>Reply</button>
                )}
              </>
            )}
          </section>
        ))}
      </div>
      {forum && !forum.locked && (
        <form className={styles.messageForm} onSubmit={createMessage}>
          <textarea aria-label="New message" maxLength={2000} required placeholder="Write a message…" value={messageBody} onChange={(event) => setMessageBody(event.target.value)} />
          <div className={styles.formActions}>
            <button className={`ui-primaryButton ${styles.primaryAction}`} type="submit" disabled={busy || !messageBody.trim()}>Send message</button>
          </div>
        </form>
      )}
      {confirmationDialog}
    </section>
  );
}
