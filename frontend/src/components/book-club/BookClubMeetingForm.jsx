import { useEffect, useState } from "react";
import { createBookClubMeeting, getBookClub } from "../../api/bookClub.js";
import { updateModule } from "../../api/feed.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { fromDateTimeLocal, toDateTimeLocal } from "../../utils/time.js";
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
        const bookOrder = nextSummary.configuration.bookOwnerOrderUserIds;
        const snackOrder = nextSummary.configuration.snackOwnerOrderUserIds;
        setSummary(nextSummary);
        setDraft({
          title: meeting?.bookTitle ?? nextSummary.activeBook?.title ?? "",
          author: meeting?.bookAuthor ?? nextSummary.activeBook?.author ?? "",
          readingTarget: meeting?.readingTarget ?? "",
          scheduledAt: toDateTimeLocal(meeting?.scheduledAt ?? nextSummary.configuration.suggestedMeetingAt),
          bookOwnerId: meeting?.bookOwnerId ?? bookOrder[0] ?? "",
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
      title: draft.title.trim(),
      author: draft.author.trim(),
      readingTarget: draft.readingTarget.trim(),
      scheduledAt: fromDateTimeLocal(draft.scheduledAt),
      bookOwnerId: draft.bookOwnerId,
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

  return (
    <form className={styles.form} onSubmit={submit}>
      {error && <p className="ui-errorBox">{error}</p>}
      <label><span>Book title</span><input required maxLength={160} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
      <label><span>Author</span><input required maxLength={160} value={draft.author} onChange={(event) => setDraft({ ...draft, author: event.target.value })} /></label>
      <label><span>Reading target</span><input required maxLength={160} placeholder="Read through Chapter 8" value={draft.readingTarget} onChange={(event) => setDraft({ ...draft, readingTarget: event.target.value })} /></label>
      <label><span>Meeting date and time</span><input required type="datetime-local" value={draft.scheduledAt} onChange={(event) => setDraft({ ...draft, scheduledAt: event.target.value })} /></label>
      <LoopingOwnerPicker
        label="Book owner"
        order={summary.configuration.bookOwnerOrderUserIds}
        roommates={roommates}
        value={draft.bookOwnerId}
        onChange={(bookOwnerId) => setDraft({ ...draft, bookOwnerId })}
        disabled={saving}
        expanded={openOwnerPicker === "book"}
        onExpandedChange={(expanded) => setOpenOwnerPicker(expanded ? "book" : null)}
      />
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
