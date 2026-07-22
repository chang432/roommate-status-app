import { useCallback, useEffect, useState } from "react";
import {
  configureBookClub,
  getBookClub,
  getCompletedBookClubBooks,
  notifyBookClubMeeting,
  setBookClubResponse,
  startNextBook,
  updateBookClubNextSession,
} from "../../api/bookClub.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { isAdminIn } from "../../utils/roles.js";
import ModalShell from "../ui/ModalShell.jsx";
import styles from "./BookClub.module.css";

const EASTERN_FORMAT = new Intl.DateTimeFormat("en-US", {
  weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit",
  timeZone: "America/New_York",
});

// This intentionally owns only the Book Club card. Its group-level visibility
// remains the responsibility of StatusPage, so disabling the toggle removes
// this whole feature without affecting its stored history.
export default function BookClub({ roommates = [], groupId, refreshToken = 0 }) {
  const { user } = useAuth();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [notifying, setNotifying] = useState(false);
  const [openPopup, setOpenPopup] = useState(null);
  const [completedBooks, setCompletedBooks] = useState([]);
  const [booksLoading, setBooksLoading] = useState(false);
  const [setup, setSetup] = useState({ title: "", author: "", readingTarget: "" });
  const [editing, setEditing] = useState(false);
  const [startingNextBook, setStartingNextBook] = useState(false);
  const [nextBook, setNextBook] = useState({ title: "", author: "", readingTarget: "" });
  const [draft, setDraft] = useState({
    title: "", author: "", readingTarget: "", recommendedById: "", snackDutyUserId: "", meetingOffset: 0,
  });

  const canAdminister = isAdminIn(roommates, user?.id);

  const loadSummary = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    getBookClub(user.id)
      .then(({ summary: nextSummary }) => {
        if (!cancelled) {
          setSummary(nextSummary);
          setError("");
        }
      })
      .catch((err) => !cancelled && setError(err.message || "Could not load Book Club."))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [user.id]);

  useEffect(() => loadSummary(), [groupId, loadSummary, refreshToken]);

  useEffect(() => {
    const scheduledAt = summary?.nextSession?.scheduledAt;
    if (!scheduledAt) return undefined;
    // Keep an open app aligned with the server's lazy rollover trigger. A
    // later visit still advances the meeting if nobody had the app open.
    const timer = window.setTimeout(loadSummary, Math.max(250, scheduledAt - Date.now() + 250));
    return () => window.clearTimeout(timer);
  }, [loadSummary, summary?.nextSession?.scheduledAt]);

  async function submitSetup(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const { summary: nextSummary } = await configureBookClub(user.id, setup);
      setSummary(nextSummary);
    } catch (err) {
      setError(err.message || "Could not configure Book Club.");
    } finally {
      setSaving(false);
    }
  }

  async function updateResponse(response, changes) {
    if (saving || !summary?.nextSession) return;
    setSaving(true);
    setError("");
    try {
      const { summary: nextSummary } = await setBookClubResponse(
        user.id,
        summary.nextSession.id,
        changes.attendanceStatus ?? response.attendanceStatus ?? "not_attending",
        changes.chaptersReadThrough ?? response.chaptersReadThrough ?? 0,
      );
      setSummary(nextSummary);
    } catch (err) {
      setError(err.message || "Could not save your reading update.");
    } finally {
      setSaving(false);
    }
  }

  function startEditing() {
    const book = summary?.activeBook;
    setDraft({
      title: book?.title || "",
      author: book?.author || "",
      readingTarget: summary?.nextSession?.readingTarget || "",
      recommendedById: book?.recommendedById || roommates[0]?.id || "",
      snackDutyUserId: summary?.nextSession?.snackDutyUserId || roommates[0]?.id || "",
      meetingOffset: 0,
    });
    setStartingNextBook(false);
    setEditing(true);
  }

  function rotateMember(field, direction) {
    if (!roommates.length) return;
    const index = Math.max(0, roommates.findIndex((member) => member.id === draft[field]));
    const nextIndex = (index + direction + roommates.length) % roommates.length;
    setDraft({ ...draft, [field]: roommates[nextIndex].id });
  }

  function rotateMeetingTime(direction) {
    setDraft({ ...draft, meetingOffset: draft.meetingOffset + direction });
  }

  async function saveNextSession(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const { summary: nextSummary } = await updateBookClubNextSession(user.id, draft);
      setSummary(nextSummary);
      setEditing(false);
    } catch (err) {
      setError(err.message || "Could not update the next meeting.");
    } finally {
      setSaving(false);
    }
  }

  function beginNextBook() {
    setNextBook({ title: "", author: "", readingTarget: "" });
    setEditing(false);
    setStartingNextBook(true);
  }

  async function submitNextBook(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const { summary: nextSummary } = await startNextBook(user.id, nextBook);
      setSummary(nextSummary);
      setStartingNextBook(false);
    } catch (err) {
      setError(err.message || "Could not start the next book.");
    } finally {
      setSaving(false);
    }
  }

  async function notifyNextMeeting() {
    if (notifying || !summary?.nextSession) return;
    setNotifying(true);
    setError("");
    try {
      await notifyBookClubMeeting(
        user.id,
        summary.nextSession.id,
      );
    } catch (err) {
      setError(err.message || "Could not send the meeting reminder.");
    } finally {
      setNotifying(false);
    }
  }

  async function openBookHistory() {
    setOpenPopup("books");
    setBooksLoading(true);
    setError("");
    try {
      const { books } = await getCompletedBookClubBooks(user.id);
      setCompletedBooks(books);
    } catch (err) {
      setError(err.message || "Could not load book history.");
    } finally {
      setBooksLoading(false);
    }
  }

  const recommender = roommates.find((member) => member.id === draft.recommendedById);
  const snackDutyMember = roommates.find((member) => member.id === draft.snackDutyUserId);
  const editedMeetingTime = summary?.nextSession
    ? summary.nextSession.scheduledAt + draft.meetingOffset * 14 * 24 * 60 * 60 * 1000
    : null;
  const snackRotation = summary?.configuration?.snackRotationUserIds ?? [];
  const snackRotationCursor = summary?.configuration?.snackRotationCursor ?? 0;
  const snackRotationMembers = snackRotation.map((memberId, index) => {
    const rotationIndex = (snackRotationCursor + index) % snackRotation.length;
    const userId = snackRotation[rotationIndex];
    return {
      userId,
      name: roommates.find((member) => member.id === userId)?.name || "Former member",
      position: index,
    };
  });
  const booksForHistory = [summary?.activeBook, ...completedBooks].filter(Boolean);

  return (
    <section className={styles.section} aria-label="Book Club">
      {loading && <p className={styles.muted}>Loading Book Club…</p>}
      {error && <p className="ui-errorBox">{error}</p>}
      {!loading && !summary && (
        canAdminister ? (
          <form className={styles.setup} onSubmit={submitSetup}>
            <p>Start the club with the first book and reading target.</p>
            <label>Book title<input required value={setup.title} onChange={(event) => setSetup({ ...setup, title: event.target.value })} /></label>
            <label>Author<input required value={setup.author} onChange={(event) => setSetup({ ...setup, author: event.target.value })} /></label>
            <label>First reading target<input required placeholder="Read through Chapter 8" value={setup.readingTarget} onChange={(event) => setSetup({ ...setup, readingTarget: event.target.value })} /></label>
            <button type="submit" disabled={saving}>{saving ? "Saving…" : "Set up Book Club"}</button>
          </form>
        ) : <p className={styles.muted}>An admin has not configured Book Club yet.</p>
      )}
      {summary && (
        <div className={styles.summary}>
          <div className={styles.dynamicField}><strong>Book:</strong><button type="button" className={styles.valueButton} onClick={openBookHistory}>{summary.activeBook?.title || "To be chosen"} by {summary.activeBook?.author || "an admin"}</button></div>
          <div className={styles.dynamicField}><strong>Chapter goal:</strong><span>{summary.nextSession.readingTarget || "To be set"}</span></div>
          <div className={styles.dynamicField}><strong>Next meeting:</strong><span>{EASTERN_FORMAT.format(summary.nextSession.scheduledAt)}</span></div>
          <div className={styles.dynamicField}><strong>Snack duty:</strong><button type="button" className={styles.valueButton} onClick={() => setOpenPopup("snacks")}>{summary.nextSession.snackDutyName}</button></div>
          {canAdminister && !editing && !startingNextBook && (
            <div className={styles.adminActions}>
              <button type="button" className={styles.startBookButton} onClick={beginNextBook}>Start next book</button>
              <button type="button" className={styles.editButton} onClick={startEditing}>Edit upcoming meeting</button>
            </div>
          )}
          {canAdminister && startingNextBook && (
            <form className={styles.setup} onSubmit={submitNextBook}>
              <p>Complete the current book and begin a new one for the upcoming meeting.</p>
              <label>Book title<input required value={nextBook.title} onChange={(event) => setNextBook({ ...nextBook, title: event.target.value })} /></label>
              <label>Author<input required value={nextBook.author} onChange={(event) => setNextBook({ ...nextBook, author: event.target.value })} /></label>
              <label>Chapter goal<input required placeholder="Read through Chapter 1" value={nextBook.readingTarget} onChange={(event) => setNextBook({ ...nextBook, readingTarget: event.target.value })} /></label>
              <div className={styles.editorActions}>
                <button type="submit" disabled={saving}>{saving ? "Starting…" : "Start next book"}</button>
                <button type="button" className={styles.cancelButton} disabled={saving} onClick={() => setStartingNextBook(false)}>Cancel</button>
              </div>
            </form>
          )}
          {canAdminister && editing && (
            <form className={styles.setup} onSubmit={saveNextSession}>
              <label>Book title<input required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
              <label>Author<input required value={draft.author} onChange={(event) => setDraft({ ...draft, author: event.target.value })} /></label>
              <label>Chapter goal<input required value={draft.readingTarget} onChange={(event) => setDraft({ ...draft, readingTarget: event.target.value })} /></label>
              <div className={styles.recommender}>
                <span>Meeting time</span>
                <div>
                  <button type="button" aria-label="Previous meeting time" onClick={() => rotateMeetingTime(-1)} disabled={saving || draft.meetingOffset <= -26}>←</button>
                  <strong>{editedMeetingTime && EASTERN_FORMAT.format(editedMeetingTime)}</strong>
                  <button type="button" aria-label="Next meeting time" onClick={() => rotateMeetingTime(1)} disabled={saving || draft.meetingOffset >= 26}>→</button>
                </div>
              </div>
              <div className={styles.recommender}>
                <span>Recommended by</span>
                <div>
                  <button type="button" aria-label="Previous recommender" onClick={() => rotateMember("recommendedById", -1)} disabled={saving}>←</button>
                  <strong>{recommender?.name || "Choose a member"}</strong>
                  <button type="button" aria-label="Next recommender" onClick={() => rotateMember("recommendedById", 1)} disabled={saving}>→</button>
                </div>
              </div>
              <div className={styles.recommender}>
                <span>Snack duty</span>
                <div>
                  <button type="button" aria-label="Previous snack duty member" onClick={() => rotateMember("snackDutyUserId", -1)} disabled={saving}>←</button>
                  <strong>{snackDutyMember?.name || "Choose a member"}</strong>
                  <button type="button" aria-label="Next snack duty member" onClick={() => rotateMember("snackDutyUserId", 1)} disabled={saving}>→</button>
                </div>
              </div>
              <div className={styles.editorActions}>
                <button type="submit" disabled={saving}>{saving ? "Saving…" : "Save meeting"}</button>
                <button type="button" className={styles.cancelButton} disabled={saving} onClick={() => setEditing(false)}>Cancel</button>
              </div>
            </form>
          )}
          <div className={styles.responses}>
            <div className={styles.responsesHeader}>
              <p className={styles.responsesTitle}>Meeting plans</p>
              <button
                type="button"
                className={styles.notifyButton}
                disabled={notifying}
                onClick={notifyNextMeeting}
                aria-label="Notify everyone about next meeting"
                title="Notify everyone about next meeting"
              >
                <img src="/bell.png" alt="" className={styles.notifyIcon} />
              </button>
            </div>
            {summary.nextSession.responses.map((response) => {
              const mine = response.userId === user.id;
              return <div className={styles.response} key={response.userId}>
                <span>{response.userName}</span>
                {mine ? <span className={styles.responseControls}>
                  <select aria-label="Your attendance" value={response.attendanceStatus || "not_attending"} disabled={saving} onChange={(event) => updateResponse(response, { attendanceStatus: event.target.value })}>
                    <option value="attending">Attending</option><option value="maybe">Maybe</option><option value="not_attending">Not attending</option>
                  </select>
                  <input aria-label="Chapters read through" type="number" min="0" defaultValue={response.chaptersReadThrough ?? ""} disabled={saving} placeholder="Chapters" onBlur={(event) => event.target.value !== "" && updateResponse(response, { chaptersReadThrough: Number(event.target.value) })} />
                </span> : <span className={styles.muted}>{response.attendanceStatus.replace("_", " ")} · through chapter {response.chaptersReadThrough}</span>}
              </div>;
            })}
          </div>
        </div>
      )}
      {openPopup === "books" && (
        <ModalShell title="Book history" onClose={() => setOpenPopup(null)} contentClassName={styles.popupContent}>
          {booksLoading ? <p className={styles.muted}>Loading books…</p> : (
            <ol className={styles.popupList}>
              {booksForHistory.map((book, index) => (
                <li className={styles.popupItem} key={book.id}>
                  <div>
                    <strong>{book.title}</strong>
                    <span>{book.author}</span>
                  </div>
                  <div className={styles.popupMeta}>
                    {index === 0 && summary.activeBook?.id === book.id ? <span className={styles.currentBadge}>Current book</span> : null}
                    <span>Recommended by {book.recommendedByName}</span>
                  </div>
                </li>
              ))}
              {!booksForHistory.length && <li className={styles.muted}>No books have been selected yet.</li>}
            </ol>
          )}
        </ModalShell>
      )}
      {openPopup === "snacks" && (
        <ModalShell title="Snack-duty rotation" onClose={() => setOpenPopup(null)} contentClassName={styles.popupContent}>
          <ol className={styles.popupList}>
            {snackRotationMembers.map((member) => (
              <li className={styles.popupItem} key={`${member.userId}-${member.position}`}>
                <strong>{member.name}</strong>
                <span className={styles.popupMeta}>{member.position === 0 ? "Current snack duty" : `Coming up #${member.position}`}</span>
              </li>
            ))}
            {!snackRotationMembers.length && <li className={styles.muted}>No snack-duty rotation has been configured.</li>}
          </ol>
        </ModalShell>
      )}
    </section>
  );
}
