import { useState } from "react";
import {
  addBookClubBook,
  setBookClubCurrentBook,
  updateBookClubBook,
} from "../../api/bookClub.js";
import { useAuth } from "../../context/AuthContext.jsx";
import styles from "./BookClubMeetingForm.module.css";

export default function BookClubBookForm({
  book = null,
  roommates,
  canAdminister = false,
  onSaved,
  onCancel,
}) {
  const { user } = useAuth();
  const [draft, setDraft] = useState({
    title: book?.title ?? "",
    author: book?.author ?? "",
    bookOwnerId: book?.bookOwnerId ?? roommates[0]?.id ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const payload = {
        title: draft.title.trim(),
        author: draft.author.trim(),
        bookOwnerId: draft.bookOwnerId,
      };
      const response = book
        ? await updateBookClubBook(user.id, book.id, payload)
        : await addBookClubBook(user.id, payload);
      window.dispatchEvent(new Event("roomie:book-club-changed"));
      await onSaved?.(response);
    } catch (err) {
      setError(err.message || "Could not save the book.");
    } finally {
      setSaving(false);
    }
  }

  async function setAsCurrent() {
    if (saving || !book) return;
    setSaving(true);
    setError("");
    try {
      const response = await setBookClubCurrentBook(user.id, book.id);
      window.dispatchEvent(new Event("roomie:book-club-changed"));
      await onSaved?.(response);
    } catch (err) {
      setError(err.message || "Could not set the current book.");
    } finally {
      setSaving(false);
    }
  }

  const canSetAsCurrent = book
    && book.status === "active"
    && !book.isCurrent
    && canAdminister;

  return (
    <form className={styles.form} onSubmit={submit}>
      {error && <p className="ui-errorBox">{error}</p>}
      <label>
        <span>Book title</span>
        <input required maxLength={160} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
      </label>
      <label>
        <span>Author</span>
        <input required maxLength={160} value={draft.author} onChange={(event) => setDraft({ ...draft, author: event.target.value })} />
      </label>
      <label>
        <span>Book owner</span>
        <select required value={draft.bookOwnerId} onChange={(event) => setDraft({ ...draft, bookOwnerId: event.target.value })}>
          {roommates.map((roommate) => <option key={roommate.id} value={roommate.id}>{roommate.name}</option>)}
        </select>
      </label>
      <div className="ui-formActions">
        <button type="button" className="ui-secondaryButton ui-formActionButton" disabled={saving} onClick={onCancel}>Cancel</button>
        {canSetAsCurrent && (
          <button type="button" className="ui-secondaryButton ui-formActionButton" disabled={saving} onClick={setAsCurrent}>
            {saving ? "Setting…" : "Set as current book"}
          </button>
        )}
        <button type="submit" className="ui-primaryButton ui-formActionButton" disabled={saving}>
          {saving ? "Saving…" : book ? "Save book" : "Add book"}
        </button>
      </div>
    </form>
  );
}
