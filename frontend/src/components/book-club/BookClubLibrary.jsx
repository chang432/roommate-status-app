import { useEffect, useMemo, useState } from "react";
import { reviewBookClubBook } from "../../api/bookClub.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { cx } from "../../utils/classNames.js";
import styles from "./BookClubLibrary.module.css";

function completedDate(value) {
  if (!value) return "Completion date unavailable";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function stars(value) {
  return `${"★".repeat(value)}${"☆".repeat(5 - value)}`;
}

export default function BookClubLibrary({ books, onBooksChange }) {
  const { user } = useAuth();
  const initialReview = books[0]?.viewerReview;
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(books[0]?.id ?? null);
  const [rating, setRating] = useState(initialReview?.rating?.toString() ?? "");
  const [finished, setFinished] = useState(
    typeof initialReview?.finished === "boolean"
      ? initialReview.finished.toString()
      : "",
  );
  const [note, setNote] = useState(initialReview?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const filteredBooks = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return books;
    return books.filter((book) =>
      [book.title, book.author, book.bookOwnerName]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(normalized)),
    );
  }, [books, query]);
  const selected = books.find((book) => book.id === selectedId) ?? books[0] ?? null;

  useEffect(() => {
    if (!books.length || books.some((book) => book.id === selectedId)) return;
    const book = books[0];
    setSelectedId(book.id);
    setRating(book.viewerReview?.rating?.toString() ?? "");
    setFinished(
      typeof book.viewerReview?.finished === "boolean"
        ? book.viewerReview.finished.toString()
        : "",
    );
    setNote(book.viewerReview?.note ?? "");
    setSaved(false);
    setError("");
  }, [books, selectedId]);

  function selectBook(book) {
    setSelectedId(book.id);
    setRating(book.viewerReview?.rating?.toString() ?? "");
    setFinished(
      typeof book.viewerReview?.finished === "boolean"
        ? book.viewerReview.finished.toString()
        : "",
    );
    setNote(book.viewerReview?.note ?? "");
    setSaved(false);
    setError("");
  }

  async function submitReview(event) {
    event.preventDefault();
    if (!selected || busy || !rating || !finished) return;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const { books: updated } = await reviewBookClubBook(user.id, selected.id, {
        rating: Number(rating),
        finished: finished === "true",
        note,
      });
      onBooksChange(updated);
      setSaved(true);
    } catch (err) {
      setError(err.message || "Could not save your review.");
    } finally {
      setBusy(false);
    }
  }

  if (!books.length) {
    return (
      <div className={styles.empty}>
        <span aria-hidden="true">📚</span>
        <h2>No completed books yet</h2>
        <p>Completed books and community reviews will collect here.</p>
      </div>
    );
  }

  return (
    <div className={styles.layout}>
      <section className={styles.library} aria-label="Completed books">
        <div className={styles.libraryHeading}>
          <div>
            <p className={styles.eyebrow}>Library</p>
            <h2>{books.length} completed {books.length === 1 ? "book" : "books"}</h2>
          </div>
          <label className={styles.search}>
            <span className="sr-only">Search completed books</span>
            <input
              type="search"
              placeholder="Search title, author, or owner"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>
        <div className={styles.bookGrid}>
          {filteredBooks.map((book) => (
            <button
              key={book.id}
              type="button"
              onClick={() => selectBook(book)}
              className={cx(styles.bookCard, selected?.id === book.id && styles.selected)}
              aria-pressed={selected?.id === book.id}
            >
              <span className={styles.bookSpine} aria-hidden="true" />
              <span className={styles.bookCopy}>
                <strong>{book.title}</strong>
                <span>by {book.author}</span>
                <small>Owned by {book.bookOwnerName || "Former member"}</small>
                <span className={styles.cardStats}>
                  <span>{book.averageRating ? `${book.averageRating.toFixed(1)} ★` : "No ratings"}</span>
                  <span>{book.finishedCount}/{book.reviewCount} finished</span>
                </span>
              </span>
            </button>
          ))}
          {!filteredBooks.length && (
            <p className={styles.noMatches}>No books match “{query.trim()}”.</p>
          )}
        </div>
      </section>

      {selected && (
        <aside className={styles.detail} aria-label={`${selected.title} reviews`}>
          <header className={styles.detailHeader}>
            <p className={styles.eyebrow}>Completed {completedDate(selected.completedAt)}</p>
            <h2>{selected.title}</h2>
            <p>by {selected.author}</p>
            <dl>
              <div><dt>Book owner</dt><dd>{selected.bookOwnerName || "Former member"}</dd></div>
              <div><dt>Average</dt><dd>{selected.averageRating ? `${selected.averageRating.toFixed(1)} / 5` : "No reviews"}</dd></div>
              <div><dt>Finished</dt><dd>{selected.finishedCount} of {selected.reviewCount}</dd></div>
            </dl>
          </header>

          <form className={styles.reviewForm} onSubmit={submitReview}>
            <div className={styles.formHeading}>
              <div>
                <h3>Your review</h3>
                {selected.viewerReview?.finished == null && selected.viewerReview && (
                  <p>Finish status not recorded—please confirm it below.</p>
                )}
              </div>
              {saved && <span role="status">Saved</span>}
            </div>
            <fieldset>
              <legend>Rating</legend>
              <div className={styles.starChoices}>
                {[1, 2, 3, 4, 5].map((value) => (
                  <label key={value}>
                    <input
                      type="radio"
                      name="book-rating"
                      value={value}
                      checked={rating === value.toString()}
                      onChange={(event) => setRating(event.target.value)}
                      disabled={busy}
                      required
                    />
                    <span aria-hidden="true">★</span>
                    <span className="sr-only">{value} star{value === 1 ? "" : "s"}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>Did you finish it?</legend>
              <div className={styles.finishChoices}>
                <label>
                  <input type="radio" name="book-finished" value="true" checked={finished === "true"} onChange={(event) => setFinished(event.target.value)} required disabled={busy} />
                  <span>Finished</span>
                </label>
                <label>
                  <input type="radio" name="book-finished" value="false" checked={finished === "false"} onChange={(event) => setFinished(event.target.value)} required disabled={busy} />
                  <span>Didn’t finish</span>
                </label>
              </div>
            </fieldset>
            <label className={styles.note}>
              <span>Optional note</span>
              <textarea maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="What stayed with you?" disabled={busy} />
              <small>{note.length}/1000</small>
            </label>
            {error && <p className="ui-errorBox">{error}</p>}
            <button className="ui-primaryButton" type="submit" disabled={busy || !rating || !finished}>
              {busy ? "Saving…" : selected.viewerReview ? "Update review" : "Save review"}
            </button>
          </form>

          <section className={styles.community} aria-labelledby="community-reviews">
            <h3 id="community-reviews">Community reviews</h3>
            {!selected.reviews.length && <p className={styles.muted}>No reviews yet. Be the first.</p>}
            <div className={styles.reviewList}>
              {selected.reviews.map((review) => (
                <article key={review.userId} className={styles.review}>
                  <div>
                    <strong>{review.userName}</strong>
                    <span aria-label={`${review.rating} out of 5 stars`}>{stars(review.rating)}</span>
                  </div>
                  <p className={styles.finishStatus}>
                    {review.finished === true
                      ? "Finished"
                      : review.finished === false
                        ? "Didn’t finish"
                        : "Finish status not recorded"}
                  </p>
                  {review.note && <p>{review.note}</p>}
                </article>
              ))}
            </div>
          </section>
        </aside>
      )}
    </div>
  );
}
