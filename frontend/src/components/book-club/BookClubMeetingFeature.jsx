import { useCallback, useEffect, useState } from "react";
import {
  completeBookClubMeeting,
  createBookClubForumEntry,
  deleteBookClubForumEntry,
  getBookClubForum,
  getBookClubMeeting,
  notifyBookClubMeeting,
  setBookClubResponse,
  updateBookClubForumEntry,
} from "../../api/bookClub.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { exactDateTime, relativeTime } from "../../utils/time.js";
import styles from "./BookClubMeetingFeature.module.css";

export default function BookClubMeetingFeature({
  meetings,
  canAdminister,
  focusMeetingId,
  focusThreadId,
  onEdit,
  onChanged,
}) {
  const { user } = useAuth();
  const [expandedId, setExpandedId] = useState(focusMeetingId ?? null);
  const [panel, setPanel] = useState(focusMeetingId ? "forum" : "details");
  const [details, setDetails] = useState({});
  const [forums, setForums] = useState({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [topicTitle, setTopicTitle] = useState("");
  const [topicBody, setTopicBody] = useState("");
  const [replyTo, setReplyTo] = useState(null);
  const [replyBody, setReplyBody] = useState("");
  const [editing, setEditing] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const loadMeetingDetails = useCallback(async (meetingId) => {
    try {
      const response = await getBookClubMeeting(user.id, meetingId);
      setDetails((current) => ({ ...current, [meetingId]: response.meeting }));
    } catch (err) {
      setError(err.message || "Could not load meeting details.");
    }
  }, [user.id]);

  const loadForum = useCallback(async (meetingId) => {
    try {
      const { forum } = await getBookClubForum(user.id, meetingId);
      setForums((current) => ({ ...current, [meetingId]: forum }));
      return forum;
    } catch (err) {
      setError(err.message || "Could not load the meeting forum.");
      return null;
    }
  }, [user.id]);

  useEffect(() => {
    if (!focusMeetingId) return;
    setExpandedId(focusMeetingId);
    setPanel("forum");
    void Promise.all([
      loadMeetingDetails(focusMeetingId),
      loadForum(focusMeetingId),
    ]);
  }, [focusMeetingId, loadForum, loadMeetingDetails]);

  useEffect(() => {
    if (!focusThreadId || !forums[focusMeetingId]) return;
    requestAnimationFrame(() => {
      document.getElementById(`forum-${focusThreadId}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
  }, [focusMeetingId, focusThreadId, forums]);

  async function toggle(meeting) {
    if (expandedId === meeting.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(meeting.id);
    setPanel("details");
    setError("");
    await loadMeetingDetails(meeting.id);
  }

  async function showForum(meetingId) {
    setPanel("forum");
    setError("");
    if (!forums[meetingId]) await loadForum(meetingId);
  }

  async function saveResponse(meeting, response, changes) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await setBookClubResponse(
        user.id,
        meeting.id,
        changes.attendanceStatus ?? response.attendanceStatus,
        changes.chaptersReadThrough ?? response.chaptersReadThrough,
      );
      setDetails((current) => ({ ...current, [meeting.id]: result.meeting }));
    } catch (err) {
      setError(err.message || "Could not save your meeting plan.");
    } finally {
      setBusy(false);
    }
  }

  async function complete(meeting) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await completeBookClubMeeting(user.id, meeting.id);
      window.dispatchEvent(new Event("roomie:book-club-changed"));
      await onChanged();
    } catch (err) {
      setError(err.message || "Could not complete the meeting.");
    } finally {
      setBusy(false);
    }
  }

  async function notify(meeting) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await notifyBookClubMeeting(user.id, meeting.id);
    } catch (err) {
      setError(err.message || "Could not send the reminder.");
    } finally {
      setBusy(false);
    }
  }

  async function createTopic(event, meetingId) {
    event.preventDefault();
    if (!topicTitle.trim() || !topicBody.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const { forum } = await createBookClubForumEntry(user.id, meetingId, {
        title: topicTitle,
        body: topicBody,
      });
      setForums((current) => ({ ...current, [meetingId]: forum }));
      setTopicTitle("");
      setTopicBody("");
    } catch (err) {
      setError(err.message || "Could not create the topic.");
    } finally {
      setBusy(false);
    }
  }

  async function createReply(event, meetingId) {
    event.preventDefault();
    if (!replyTo || !replyBody.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const { forum } = await createBookClubForumEntry(user.id, meetingId, {
        parentPostId: replyTo,
        body: replyBody,
      });
      setForums((current) => ({ ...current, [meetingId]: forum }));
      setReplyTo(null);
      setReplyBody("");
    } catch (err) {
      setError(err.message || "Could not add the reply.");
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(event, meetingId) {
    event.preventDefault();
    if (!editing?.body.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const { forum } = await updateBookClubForumEntry(
        user.id,
        meetingId,
        editing.id,
        { title: editing.title, body: editing.body },
      );
      setForums((current) => ({ ...current, [meetingId]: forum }));
      setEditing(null);
    } catch (err) {
      setError(err.message || "Could not update the forum entry.");
    } finally {
      setBusy(false);
    }
  }

  async function removeEntry(meetingId, entryId) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const { forum } = await deleteBookClubForumEntry(user.id, meetingId, entryId);
      setForums((current) => ({ ...current, [meetingId]: forum }));
      setConfirmDeleteId(null);
    } catch (err) {
      setError(err.message || "Could not remove the forum entry.");
    } finally {
      setBusy(false);
    }
  }

  function entryActions(entry, meetingId, locked) {
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
            <button type="button" className={styles.danger} disabled={busy} onClick={() => removeEntry(meetingId, entry.id)}>Confirm remove</button>
            <button type="button" onClick={() => setConfirmDeleteId(null)}>Cancel</button>
          </>
        ) : (
          <button type="button" onClick={() => setConfirmDeleteId(entry.id)}>Remove</button>
        )}
      </div>
    );
  }

  function renderEntry(entry, meetingId, locked, reply = false) {
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
          {entryActions(entry, meetingId, locked)}
        </header>
        {isEditing ? (
          <form className={styles.editForm} onSubmit={(event) => saveEdit(event, meetingId)}>
            {!editing.isReply && (
              <input aria-label="Topic title" maxLength={120} required value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })} />
            )}
            <textarea aria-label="Forum post" maxLength={editing.isReply ? 1000 : 2000} required value={editing.body} onChange={(event) => setEditing({ ...editing, body: event.target.value })} />
            <div>
              <button type="submit" className="ui-primaryButton" disabled={busy}>Save</button>
              <button type="button" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </form>
        ) : entry.deletedAt ? (
          <p className={styles.deleted}>This {reply ? "reply" : "topic"} was removed{entry.deletedByName ? ` by ${entry.deletedByName}` : ""}.</p>
        ) : (
          <>
            {!reply && <h4>{entry.title}</h4>}
            <p className={styles.entryBody}>{entry.body}</p>
          </>
        )}
      </article>
    );
  }

  if (!meetings.length) {
    return <p className={styles.empty}>No Book Club meetings yet.</p>;
  }

  return (
    <div className={styles.list}>
      {error && <p className="ui-errorBox">{error}</p>}
      {meetings.map((meeting) => {
        const detail = details[meeting.id] || meeting;
        const forum = forums[meeting.id];
        const expanded = expandedId === meeting.id;
        return (
          <article key={meeting.id} className={styles.card}>
            <button type="button" className={styles.header} aria-expanded={expanded} onClick={() => toggle(meeting)}>
              <span className={styles.dateBlock}>
                <strong>{new Intl.DateTimeFormat(undefined, { month: "short" }).format(new Date(meeting.scheduledAt))}</strong>
                <span>{new Date(meeting.scheduledAt).getDate()}</span>
              </span>
              <span className={styles.headerText}>
                <span className={styles.title}>{meeting.bookTitle}</span>
                <span className={styles.meta}>{exactDateTime(meeting.scheduledAt)} · Snacks: {meeting.snackOwnerName}</span>
              </span>
              <span className={styles.status}>{meeting.status === "completed" ? "Completed" : "Upcoming"}</span>
              <span className={styles.chevron} aria-hidden="true">⌄</span>
            </button>
            <div className={`${styles.expandedRegion} ${expanded ? styles.expanded : styles.collapsed}`}>
              <div className={styles.expandedInner} {...(!expanded ? { inert: "" } : {})}>
                <div className={styles.panelTabs} role="tablist" aria-label={`${meeting.bookTitle} meeting sections`}>
                  <button type="button" role="tab" aria-selected={panel === "details"} className={panel === "details" ? styles.activePanelTab : undefined} onClick={() => setPanel("details")}>Details</button>
                  <button type="button" role="tab" aria-selected={panel === "forum"} className={panel === "forum" ? styles.activePanelTab : undefined} onClick={() => showForum(meeting.id)}>
                    Forum {forum?.threads?.length ? `(${forum.threads.length})` : ""}
                  </button>
                </div>

                {panel === "details" ? (
                  <div className={styles.detailsPanel} role="tabpanel">
                    <dl className={styles.details}>
                      <div><dt>Reading target</dt><dd>{detail.readingTarget}</dd></div>
                      <div><dt>Book owner</dt><dd>{detail.bookOwnerName}</dd></div>
                      <div><dt>Snack owner</dt><dd>{detail.snackOwnerName}</dd></div>
                    </dl>
                    <div className={styles.responses}>
                      <h3>Attendance and progress</h3>
                      {(detail.responses || []).map((response) => {
                        const mine = response.userId === user.id;
                        return (
                          <div className={styles.response} key={response.userId}>
                            <span>{response.userName}</span>
                            {mine && detail.status === "scheduled" ? (
                              <span className={styles.responseControls}>
                                <select aria-label="Your attendance" value={response.attendanceStatus} disabled={busy} onChange={(event) => saveResponse(detail, response, { attendanceStatus: event.target.value })}>
                                  <option value="attending">Attending</option>
                                  <option value="maybe">Maybe</option>
                                  <option value="not_attending">Not attending</option>
                                </select>
                                <label><span>Through chapter</span><input aria-label="Chapters read through" type="number" min="0" value={response.chaptersReadThrough} disabled={busy} onChange={(event) => {
                                  setDetails((current) => ({
                                    ...current,
                                    [meeting.id]: {
                                      ...detail,
                                      responses: detail.responses.map((item) => item.userId === user.id ? { ...item, chaptersReadThrough: Number(event.target.value) } : item),
                                    },
                                  }));
                                }} onBlur={(event) => saveResponse(detail, { ...response, chaptersReadThrough: Number(event.target.value) }, {})} /></label>
                              </span>
                            ) : <span>{response.attendanceStatus.replace("_", " ")} · chapter {response.chaptersReadThrough}</span>}
                          </div>
                        );
                      })}
                    </div>
                    {detail.status === "scheduled" && (
                      <div className={styles.meetingActions}>
                        <button type="button" disabled={busy} onClick={() => notify(detail)}>Send reminder</button>
                        {canAdminister && <button type="button" disabled={busy} onClick={() => onEdit(detail)}>Edit meeting</button>}
                        {canAdminister && <button type="button" disabled={busy} onClick={() => complete(detail)}>Complete meeting</button>}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className={styles.forumPanel} role="tabpanel">
                    {!forum && <p className={styles.forumState}>Loading discussion…</p>}
                    {forum?.locked && <p className={styles.locked}>This forum closed when the meeting was completed.</p>}
                    {forum && !forum.threads.length && <p className={styles.forumState}>No topics yet. Start the conversation before the meeting.</p>}
                    <div className={styles.threads}>
                      {forum?.threads.map((thread) => (
                        <section key={thread.id} className={styles.thread}>
                          {renderEntry(thread, meeting.id, forum.locked)}
                          <div className={styles.replies}>
                            {thread.replies.map((reply) => renderEntry(reply, meeting.id, forum.locked, true))}
                          </div>
                          {!forum.locked && !thread.deletedAt && (
                            replyTo === thread.id ? (
                              <form className={styles.replyForm} onSubmit={(event) => createReply(event, meeting.id)}>
                                <textarea aria-label={`Reply to ${thread.title}`} autoFocus maxLength={1000} required value={replyBody} onChange={(event) => setReplyBody(event.target.value)} placeholder="Write a reply…" />
                                <div><button className="ui-primaryButton" type="submit" disabled={busy || !replyBody.trim()}>Reply</button><button type="button" onClick={() => { setReplyTo(null); setReplyBody(""); }}>Cancel</button></div>
                              </form>
                            ) : <button type="button" className={styles.replyButton} onClick={() => setReplyTo(thread.id)}>Reply</button>
                          )}
                        </section>
                      ))}
                    </div>
                    {forum && !forum.locked && (
                      <form className={styles.topicForm} onSubmit={(event) => createTopic(event, meeting.id)}>
                        <h3>Start a topic</h3>
                        <input aria-label="New topic title" maxLength={120} required placeholder="What should we discuss?" value={topicTitle} onChange={(event) => setTopicTitle(event.target.value)} />
                        <textarea aria-label="New topic post" maxLength={2000} required placeholder="Share a question or thought…" value={topicBody} onChange={(event) => setTopicBody(event.target.value)} />
                        <button className="ui-primaryButton" type="submit" disabled={busy || !topicTitle.trim() || !topicBody.trim()}>Post topic</button>
                      </form>
                    )}
                  </div>
                )}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
