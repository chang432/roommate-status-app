import { useCallback, useEffect, useState } from "react";
import {
  createBookClubForumEntry,
  deleteBookClubForumEntry,
  getBookClubForum,
  updateBookClubForumEntry,
} from "../../api/bookClub.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { relativeTime } from "../../utils/time.js";
import styles from "./BookClubForum.module.css";

export default function BookClubForum({ meeting, canAdminister, focusThreadId }) {
  const { user } = useAuth();
  const [forum, setForum] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [topicComposerOpen, setTopicComposerOpen] = useState(false);
  const [topicTitle, setTopicTitle] = useState("");
  const [topicBody, setTopicBody] = useState("");
  const [replyTo, setReplyTo] = useState(null);
  const [replyBody, setReplyBody] = useState("");
  const [editing, setEditing] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const loadForum = useCallback(async () => {
    try {
      const response = await getBookClubForum(user.id, meeting.id);
      setForum(response.forum);
      setError("");
    } catch (err) {
      setError(err.message || "Could not load the meeting forum.");
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

  async function createTopic(event) {
    event.preventDefault();
    if (!topicTitle.trim() || !topicBody.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await createBookClubForumEntry(user.id, meeting.id, {
        title: topicTitle,
        body: topicBody,
      });
      setForum(response.forum);
      setTopicTitle("");
      setTopicBody("");
      setTopicComposerOpen(false);
    } catch (err) {
      setError(err.message || "Could not create the topic.");
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
        { title: editing.title, body: editing.body },
      );
      setForum(response.forum);
      setEditing(null);
    } catch (err) {
      setError(err.message || "Could not update the forum entry.");
    } finally {
      setBusy(false);
    }
  }

  async function removeEntry(entryId) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await deleteBookClubForumEntry(user.id, meeting.id, entryId);
      setForum(response.forum);
      setConfirmDeleteId(null);
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
            title: entry.title ?? "",
            body: entry.body,
            isReply: Boolean(entry.parentPostId),
          })}>Edit</button>
        )}
        {confirmDeleteId === entry.id ? (
          <>
            <button type="button" className={styles.danger} disabled={busy} onClick={() => removeEntry(entry.id)}>Confirm remove</button>
            <button type="button" onClick={() => setConfirmDeleteId(null)}>Cancel</button>
          </>
        ) : (
          <button type="button" onClick={() => setConfirmDeleteId(entry.id)}>Remove</button>
        )}
      </div>
    );
  }

  function renderEntry(entry, locked, reply = false) {
    const isEditing = editing?.id === entry.id;
    return (
      <article
        key={entry.id}
        id={!reply ? `forum-${entry.id}` : undefined}
        className={reply ? styles.reply : styles.topic}
      >
        <header className={styles.entryHeader}>
          <div>
            <strong>{entry.authorName}</strong>
            <span>{relativeTime(entry.createdAt)}{entry.updatedAt > entry.createdAt ? " · edited" : ""}</span>
          </div>
          {entryActions(entry, locked)}
        </header>
        {isEditing ? (
          <form className={styles.editForm} onSubmit={saveEdit}>
            {!editing.isReply && (
              <input aria-label="Topic title" maxLength={120} required value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })} />
            )}
            <textarea aria-label="Forum post" maxLength={editing.isReply ? 1000 : 2000} required value={editing.body} onChange={(event) => setEditing({ ...editing, body: event.target.value })} />
            <div>
              <button type="submit" className={`ui-primaryButton ${styles.primaryAction}`} disabled={busy}>Save</button>
              <button type="button" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </form>
        ) : entry.deletedAt ? (
          <p className={styles.deleted}>This {reply ? "reply" : "topic"} was removed{entry.deletedByName ? ` by ${entry.deletedByName}` : ""}.</p>
        ) : (
          <>
            {!reply && <h3>{entry.title}</h3>}
            <p className={styles.entryBody}>{entry.body}</p>
          </>
        )}
      </article>
    );
  }

  return (
    <section className={styles.forumPanel} aria-label={`${meeting.bookTitle} forum`}>
      {error && <p className="ui-errorBox">{error}</p>}
      {!forum && !error && <p className={styles.forumState}>Loading discussion…</p>}
      {forum?.locked && <p className={styles.locked}>This forum closed when the meeting was completed.</p>}
      {forum && !forum.threads.length && <p className={styles.forumState}>No topics yet. Start the conversation before the meeting.</p>}
      <div className={styles.threads}>
        {forum?.threads.map((thread) => (
          <section key={thread.id} className={styles.thread}>
            {renderEntry(thread, forum.locked)}
            <div className={styles.replies}>
              {thread.replies.map((reply) => renderEntry(reply, forum.locked, true))}
            </div>
            {!forum.locked && !thread.deletedAt && (
              replyTo === thread.id ? (
                <form className={styles.replyForm} onSubmit={createReply}>
                  <textarea aria-label={`Reply to ${thread.title}`} autoFocus maxLength={1000} required value={replyBody} onChange={(event) => setReplyBody(event.target.value)} placeholder="Write a reply…" />
                  <div><button className={`ui-primaryButton ${styles.primaryAction}`} type="submit" disabled={busy || !replyBody.trim()}>Reply</button><button type="button" onClick={() => { setReplyTo(null); setReplyBody(""); }}>Cancel</button></div>
                </form>
              ) : <button type="button" className={styles.replyButton} onClick={() => setReplyTo(thread.id)}>Reply</button>
            )}
          </section>
        ))}
      </div>
      {forum && !forum.locked && !topicComposerOpen && (
        <div className={styles.forumActions}>
          <button type="button" className={`ui-primaryButton ${styles.primaryAction}`} onClick={() => setTopicComposerOpen(true)}>New topic</button>
        </div>
      )}
      {forum && !forum.locked && topicComposerOpen && (
        <form className={styles.topicForm} onSubmit={createTopic}>
          <h2>Start a topic</h2>
          <input autoFocus aria-label="New topic title" maxLength={120} required placeholder="What should we discuss?" value={topicTitle} onChange={(event) => setTopicTitle(event.target.value)} />
          <textarea aria-label="New topic post" maxLength={2000} required placeholder="Share a question or thought…" value={topicBody} onChange={(event) => setTopicBody(event.target.value)} />
          <div className={styles.formActions}>
            <button className={`ui-primaryButton ${styles.primaryAction}`} type="submit" disabled={busy || !topicTitle.trim() || !topicBody.trim()}>Post topic</button>
            <button type="button" onClick={() => { setTopicComposerOpen(false); setTopicTitle(""); setTopicBody(""); }}>Cancel</button>
          </div>
        </form>
      )}
    </section>
  );
}
