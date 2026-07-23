import { useState } from "react";
import {
  completeBookClubMeeting,
  createBookClubPost,
  getBookClub,
  getBookClubMeeting,
  getBookClubPosts,
  getCompletedBookClubBooks,
  notifyBookClubMeeting,
  rateBookClubBook,
  setBookClubResponse,
} from "../../api/bookClub.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { useExpandOnModuleFocus } from "../../context/ModuleFocusContext.jsx";
import { exactDateTime } from "../../utils/time.js";
import ModuleEditButton from "../feed/ModuleEditButton.jsx";
import ModalShell from "../ui/ModalShell.jsx";
import styles from "./BookClubMeetingFeature.module.css";

export default function BookClubMeetingFeature({ meetings, moduleTag, onEdit, canAdminister, onChanged }) {
  const { user } = useAuth();
  const [expandedId, setExpandedId] = useState(null);
  const [details, setDetails] = useState({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [bookDetail, setBookDetail] = useState(null);
  const [posts, setPosts] = useState([]);
  const [chapterLabel, setChapterLabel] = useState("");
  const [postBody, setPostBody] = useState("");
  useExpandOnModuleFocus(setExpandedId);

  async function toggle(meeting) {
    if (expandedId === meeting.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(meeting.id);
    try {
      const response = await getBookClubMeeting(user.id, meeting.id);
      setDetails((current) => ({ ...current, [meeting.id]: response.meeting }));
    } catch (err) {
      setError(err.message || "Could not load meeting details.");
    }
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

  async function openBook(meeting) {
    setError("");
    try {
      const [{ summary }, { books }, { posts: nextPosts }] = await Promise.all([
        getBookClub(user.id),
        getCompletedBookClubBooks(user.id),
        getBookClubPosts(user.id, meeting.bookId),
      ]);
      const book = summary.activeBook?.id === meeting.bookId
        ? summary.activeBook
        : books.find((item) => item.id === meeting.bookId);
      setBookDetail(book || {
        id: meeting.bookId, title: meeting.bookTitle, author: meeting.bookAuthor, status: "active",
      });
      setPosts(nextPosts);
    } catch (err) {
      setError(err.message || "Could not load book details.");
    }
  }

  async function rate(rating) {
    const { books } = await rateBookClubBook(user.id, bookDetail.id, Number(rating));
    setBookDetail(books.find((book) => book.id === bookDetail.id));
  }

  async function addPost(event) {
    event.preventDefault();
    const label = chapterLabel.trim();
    const body = postBody.trim();
    if (!label || !body || busy) return;
    setBusy(true);
    try {
      const chapterKey = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const { post } = await createBookClubPost(user.id, bookDetail.id, {
        chapterKey, chapterLabel: label, body,
      });
      setPosts((current) => [...current, post]);
      setPostBody("");
    } catch (err) {
      setError(err.message || "Could not add the discussion post.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.list}>
      {error && <p className="ui-errorBox">{error}</p>}
      {meetings.map((meeting) => {
        const detail = details[meeting.id] || meeting;
        const expanded = expandedId === meeting.id;
        return (
          <article key={meeting.id} className={styles.card}>
            <button
              type="button"
              className={styles.header}
              aria-expanded={expanded}
              onClick={() => toggle(meeting)}
            >
              <span className={styles.headerText}>
                <span className={styles.title}>{meeting.bookTitle}</span>
                <span className={styles.meta}>{exactDateTime(meeting.scheduledAt)} · Snacks: {meeting.snackOwnerName}</span>
              </span>
              {moduleTag}
            </button>
            {expanded && (
              <div className={styles.panel}>
                <button type="button" className={styles.bookButton} onClick={() => openBook(detail)}>
                  {detail.bookTitle} by {detail.bookAuthor}
                </button>
                <dl className={styles.details}>
                  <div><dt>Reading target</dt><dd>{detail.readingTarget}</dd></div>
                  <div><dt>Book owner</dt><dd>{detail.bookOwnerName}</dd></div>
                  <div><dt>Snack owner</dt><dd>{detail.snackOwnerName}</dd></div>
                </dl>
                {(detail.responses || []).map((response) => {
                  const mine = response.userId === user.id;
                  return (
                    <div className={styles.response} key={response.userId}>
                      <span>{response.userName}</span>
                      {mine && detail.status === "scheduled" ? (
                        <span className={styles.responseControls}>
                          <select aria-label="Your attendance" value={response.attendanceStatus} disabled={busy} onChange={(event) => saveResponse(detail, response, { attendanceStatus: event.target.value })}>
                            <option value="attending">Attending</option><option value="maybe">Maybe</option><option value="not_attending">Not attending</option>
                          </select>
                          <input aria-label="Chapters read through" type="number" min="0" defaultValue={response.chaptersReadThrough} disabled={busy} onBlur={(event) => saveResponse(detail, response, { chaptersReadThrough: Number(event.target.value) })} />
                        </span>
                      ) : <span>{response.attendanceStatus.replace("_", " ")} · chapter {response.chaptersReadThrough}</span>}
                    </div>
                  );
                })}
                {detail.status === "scheduled" && (
                  <div className="ui-moduleActionRow">
                    <button
                      type="button"
                      className="ui-pillButton ui-pillSecondary ui-moduleActionButton"
                      disabled={busy}
                      onClick={() => notify(detail)}
                    >
                      Send reminder
                    </button>
                    <ModuleEditButton onEdit={onEdit} disabled={busy} />
                    {canAdminister && (
                      <button
                        type="button"
                        className="ui-pillButton ui-pillSecondary ui-moduleActionButton"
                        disabled={busy}
                        onClick={() => complete(detail)}
                      >
                        Complete meeting
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </article>
        );
      })}
      {bookDetail && (
        <ModalShell title={bookDetail.title} onClose={() => setBookDetail(null)} contentClassName={styles.bookModal}>
          <p>{bookDetail.author}</p>
          <p className={styles.bookMeta}>Book owner: {bookDetail.bookOwnerName || "Unknown"}</p>
          {bookDetail.status === "completed" && (
            <label className={styles.rating}>Your rating
              <select value={bookDetail.viewerRating ?? ""} onChange={(event) => rate(event.target.value)}>
                <option value="" disabled>Choose 1–5</option>
                {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
          )}
          <div className={styles.posts}>
            {posts.map((post) => <article key={post.id}><strong>{post.chapterLabel} · {post.authorName}</strong><p>{post.body}</p></article>)}
            {!posts.length && <p className={styles.bookMeta}>No chapter discussion yet.</p>}
          </div>
          <form className={styles.postForm} onSubmit={addPost}>
            <input aria-label="Chapter" required placeholder="Chapter 8" value={chapterLabel} onChange={(event) => setChapterLabel(event.target.value)} />
            <textarea aria-label="Discussion post" required placeholder="Share a thought…" value={postBody} onChange={(event) => setPostBody(event.target.value)} />
            <div className="ui-formActions">
              <button
                type="submit"
                className="ui-primaryButton ui-formActionButton"
                disabled={busy}
              >
                Post
              </button>
            </div>
          </form>
        </ModalShell>
      )}
    </div>
  );
}
