import { useEffect, useState } from "react";
import { createBookClubMeeting, getBookClub } from "../../api/bookClub.js";
import { updateModule } from "../../api/feed.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { fromDateTimeLocal, toDateTimeLocal } from "../../utils/time.js";
import { openBookLibraryAdd } from "../../utils/bookClubEvents.js";
import LoopingOwnerPicker from "./LoopingOwnerPicker.jsx";
import styles from "./BookClubMeetingForm.module.css";

export default function BookClubMeetingForm({ meeting = null, roommates, onSaved, onCancel }) {
  const { user } = useAuth();
  const [summary, setSummary] = useState(null);
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [openOwnerPicker, setOpenOwnerPicker] = useState(null);

  useEffect(() => {
    let current = true;
    getBookClub(user.id)
      .then(({ summary: nextSummary }) => {
        if (!current) return;
        const snackOrder = nextSummary.configuration.snackOwnerOrderUserIds;
        setSummary(nextSummary);
        setDraft({
          readingTarget: meeting?.readingTarget ?? "",
          scheduledAt: toDateTimeLocal(meeting?.scheduledAt ?? nextSummary.configuration.suggestedMeetingAt),
          snackOwnerId: meeting?.snackOwnerId ?? snackOrder[0] ?? "",
        });
      })
      .catch((err) => current && setError(err.message || "Could not load meeting defaults."))
      .finally(() => current && setLoading(false));
    return () => { current = false; };
  }, [meeting, user.id]);

  async function submit(event) {
    event.preventDefault();
    if (!draft || saving) return;
    const payload = {
      readingTarget: draft.readingTarget.trim(),
      scheduledAt: fromDateTimeLocal(draft.scheduledAt),
      snackOwnerId: draft.snackOwnerId,
    };
    setSaving(true);
    setError("");
    try {
      if (meeting) await updateModule("book-club", meeting.id, user.id, payload);
      else await createBookClubMeeting(user.id, payload);
      window.dispatchEvent(new Event("roomie:book-club-changed"));
      await onSaved?.();
    } catch (err) {
      setError(err.message || "Could not save the meeting.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className={styles.muted}>Loading meeting defaults…</p>;
  if (!draft || !summary) return <p className="ui-errorBox">{error || "Meeting defaults are unavailable."}</p>;
  if (!meeting && !summary.activeBook) {
    return (
      <div className={styles.emptyBooks}>
        <p>There is no current book yet. Add one to the library before scheduling a meeting.</p>
        <div className="ui-formActions">
          <button type="button" className="ui-secondaryButton ui-formActionButton" onClick={onCancel}>Cancel</button>
          <button type="button" className="ui-primaryButton ui-formActionButton" onClick={() => {
            onCancel?.();
            window.setTimeout(openBookLibraryAdd, 0);
          }}>Add a book</button>
        </div>
      </div>
    );
  }

  const selectedBook = meeting
    ? { title: meeting.bookTitle, author: meeting.bookAuthor, bookOwnerName: meeting.bookOwnerName }
    : summary.activeBook;

  return (
    <form className={styles.form} onSubmit={submit}>
      {error && <p className="ui-errorBox">{error}</p>}
      <div className={styles.fixedBook}>
        <span>Book</span>
        <strong>{selectedBook.title}</strong>
        <small>by {selectedBook.author} · Book owner: {selectedBook.bookOwnerName || "Former member"}</small>
      </div>
      <label><span>Reading target</span><input required maxLength={160} placeholder="Read through Chapter 8" value={draft.readingTarget} onChange={(event) => setDraft({ ...draft, readingTarget: event.target.value })} /></label>
      <label><span>Meeting date and time</span><input required type="datetime-local" value={draft.scheduledAt} onChange={(event) => setDraft({ ...draft, scheduledAt: event.target.value })} /></label>
      <LoopingOwnerPicker
        label="Snack owner"
        order={summary.configuration.snackOwnerOrderUserIds}
        roommates={roommates}
        value={draft.snackOwnerId}
        onChange={(snackOwnerId) => setDraft({ ...draft, snackOwnerId })}
        disabled={saving}
        expanded={openOwnerPicker === "snack"}
        onExpandedChange={(expanded) => setOpenOwnerPicker(expanded ? "snack" : null)}
      />
      <div className="ui-formActions">
        <button
          type="button"
          className="ui-secondaryButton ui-formActionButton"
          disabled={saving}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="ui-primaryButton ui-formActionButton"
          disabled={saving}
        >
          {saving ? "Saving…" : meeting ? "Save meeting" : "Create meeting"}
        </button>
      </div>
    </form>
  );
}
