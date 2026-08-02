import { useEffect, useState } from "react";
import { getBookClubBooks } from "../../api/bookClub.js";
import { createForum, updateForum } from "../../api/forums.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { cx } from "../../utils/classNames.js";
import styles from "./ForumForm.module.css";

export default function ForumForm({ forum = null, onChanged, onSaved, onCancel }) {
  const { user } = useAuth();
  const [title, setTitle] = useState(forum?.title ?? "");
  const [bookId, setBookId] = useState(forum?.bookId ?? "");
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getBookClubBooks(user.id)
      .then(({ books: availableBooks }) => {
        if (!active) return;
        setBooks(availableBooks);
        setBookId((current) => current || availableBooks[0]?.id || "");
      })
      .catch((requestError) => {
        if (active) setError(requestError.message || "Could not load the book library.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user.id]);

  async function submit(event) {
    event.preventDefault();
    if (!title.trim() || !bookId || sending) return;
    setSending(true);
    setError("");
    try {
      if (forum) {
        await updateForum(forum.id, user.id, title.trim(), bookId);
      } else {
        await createForum(title.trim(), bookId, user.id);
      }
      await onChanged?.();
      await onSaved?.();
    } catch (requestError) {
      setError(requestError.message || "Could not save the forum.");
    } finally {
      setSending(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.fields}>
        <label className={styles.field}>
          <span className="ui-formLabel">Forum title</span>
          <input
            type="text"
            className={cx("ui-textInput", styles.input)}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={280}
            placeholder="What should we unpack together?"
            disabled={loading || sending}
          />
        </label>
        <label className={styles.field}>
          <span className="ui-formLabel">Book</span>
          <select
            className={cx("ui-textInput", styles.select)}
            value={bookId}
            onChange={(event) => setBookId(event.target.value)}
            disabled={loading || sending || books.length === 0}
          >
            {!bookId ? <option value="">Choose a book</option> : null}
            {books.map((book) => (
              <option value={book.id} key={book.id}>
                {book.title} — {book.author}
              </option>
            ))}
          </select>
        </label>
        {!loading && books.length === 0 ? (
          <p className={styles.empty}>Add a Book Club book before creating a forum.</p>
        ) : null}
      </div>

      {error ? <p className="ui-errorBox">{error}</p> : null}

      <div className="ui-formActions">
        <button
          type="button"
          className="ui-secondaryButton ui-formActionButton"
          onClick={onCancel}
          disabled={sending}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="ui-primaryButton ui-formActionButton"
          disabled={loading || sending || !title.trim() || !bookId}
        >
          {sending ? "Saving…" : forum ? "Save forum" : "Create forum"}
        </button>
      </div>
    </form>
  );
}
