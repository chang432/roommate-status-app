import { useEffect, useMemo, useState } from "react";
import { reviewBookClubBook } from "../../api/bookClub.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { exactDateTime } from "../../utils/time.js";
import BookClubDisclosure from "./BookClubDisclosure.jsx";
import BookClubForum from "./BookClubForum.jsx";
import styles from "./BookClubLibrary.module.css";

function bookDate(book) {
  if (book.isCurrent) return "Currently reading";
  if (book.status === "active") return "Available for a meeting";
  if (!book.completedAt) return "Completion date unavailable";
  return `Completed ${new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric", year: "numeric",
  }).format(new Date(book.completedAt))}`;
}

function ratingLabel(book) {
  return book.averageRating ? `${book.averageRating.toFixed(1)} ★` : "No ratings";
}

function finishedLabel(book) {
  return `${book.finishedCount} ${book.finishedCount === 1 ? "person" : "people"} finished`;
}

function stars(value) {
  return `${"★".repeat(value)}${"☆".repeat(5 - value)}`;
}

function statusLabel(book) {
  if (book.isCurrent) return "Current";
  if (book.status === "active") return "Available";
  return "Completed";
}

function MeetingDiscussion({ meeting, canAdminister, focusThreadId, initiallyOpen }) {
  const [open, setOpen] = useState(initiallyOpen);
  const [hasOpened, setHasOpened] = useState(initiallyOpen);
  useEffect(() => {
    if (initiallyOpen) {
      setOpen(true);
      setHasOpened(true);
    }
  }, [initiallyOpen]);

  function toggle() {
    setOpen((value) => {
      if (!value) setHasOpened(true);
      return !value;
    });
  }

  return (
    <BookClubDisclosure
      className={styles.meetingForum}
      title={exactDateTime(meeting.scheduledAt)}
      description={meeting.status === "scheduled" ? "Open meeting" : "Completed meeting"}
      badge={meeting.readingTarget}
      open={open}
      onToggle={toggle}
    >
      {/* Avoid fetching every historical forum until its meeting is opened. */}
      {hasOpened ? <BookClubForum meeting={meeting} canAdminister={canAdminister} focusThreadId={focusThreadId} /> : null}
    </BookClubDisclosure>
  );
}

function BookDetail({
  book,
  onBack,
  onBooksChange,
  onEditBook,
  canAdminister,
  focusMeetingId,
  focusThreadId,
}) {
  const { user } = useAuth();
  const initialReview = book.viewerReview;
  const [rating, setRating] = useState(initialReview?.rating?.toString() ?? "");
  const [finished, setFinished] = useState(
    typeof initialReview?.finished === "boolean" ? initialReview.finished.toString() : "",
  );
  const [note, setNote] = useState(initialReview?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [reviewsOpen, setReviewsOpen] = useState(true);
  const [discussionsOpen, setDiscussionsOpen] = useState(Boolean(focusMeetingId));

  useEffect(() => {
    if (focusMeetingId) setDiscussionsOpen(true);
  }, [focusMeetingId]);

  async function submitReview(event) {
    event.preventDefault();
    if (busy || !rating || !finished) return;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const { books: updated } = await reviewBookClubBook(user.id, book.id, {
        rating: Number(rating), finished: finished === "true", note,
      });
      onBooksChange(updated);
      setSaved(true);
    } catch (err) {
      setError(err.message || "Could not save your review.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.detail}>
      <div className={styles.detailActions}>
        <button type="button" className={`ui-secondaryButton ${styles.actionButton}`} onClick={onBack}>← All books</button>
        <button type="button" className={`ui-secondaryButton ${styles.actionButton}`} onClick={() => onEditBook(book)}>Edit book</button>
      </div>
      <header className={styles.detailHeader}>
        <div className={styles.detailTitle}>
          <div className={styles.titleRow}>
            <h2>{book.title}</h2>
            <span className={styles.statusChip}>{statusLabel(book)}</span>
          </div>
          <p>by {book.author}</p>
          <small>{bookDate(book)}</small>
        </div>
        <dl>
          <div><dt>Book owner</dt><dd>{book.bookOwnerName || "Former member"}</dd></div>
          <div><dt>Average</dt><dd>{book.averageRating ? `${book.averageRating.toFixed(1)} / 5` : "No ratings"}</dd></div>
          <div><dt>Finished</dt><dd>{book.finishedCount}</dd></div>
        </dl>
      </header>

      <BookClubDisclosure
        title="Reviews"
        description="Your review and the household"
        badge={`${book.reviewCount} ${book.reviewCount === 1 ? "review" : "reviews"}`}
        open={reviewsOpen}
        onToggle={() => setReviewsOpen((value) => !value)}
      >
        <form className={styles.reviewForm} onSubmit={submitReview}>
          <div className={styles.formHeading}>
            <div>
              <h3>Your review</h3>
              {initialReview?.finished == null && initialReview && <p>Finish status not recorded—please confirm it below.</p>}
            </div>
            {saved && <span role="status">Saved</span>}
          </div>
          <fieldset>
            <legend>Rating</legend>
            <div className={styles.starChoices}>
              {[1, 2, 3, 4, 5].map((value) => (
                <label key={value}>
                  <input type="radio" name={`book-rating-${book.id}`} value={value} checked={rating === value.toString()} onChange={(event) => setRating(event.target.value)} disabled={busy} required />
                  <span aria-hidden="true">★</span>
                  <span className="sr-only">{value} star{value === 1 ? "" : "s"}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Did you finish it?</legend>
            <div className={styles.finishChoices}>
              <label><input type="radio" name={`book-finished-${book.id}`} value="true" checked={finished === "true"} onChange={(event) => setFinished(event.target.value)} required disabled={busy} /><span>Finished</span></label>
              <label><input type="radio" name={`book-finished-${book.id}`} value="false" checked={finished === "false"} onChange={(event) => setFinished(event.target.value)} required disabled={busy} /><span>Didn’t finish</span></label>
            </div>
          </fieldset>
          <label className={styles.note}>
            <span>Optional note</span>
            <textarea maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="What stayed with you?" disabled={busy} />
            <small>{note.length}/1000</small>
          </label>
          {error && <p className="ui-errorBox">{error}</p>}
          <div className="ui-formActions">
            <button className={`ui-primaryButton ${styles.saveReview}`} type="submit" disabled={busy || !rating || !finished}>{busy ? "Saving…" : initialReview ? "Update review" : "Save review"}</button>
          </div>
        </form>
        <div className={styles.community}>
          <div className={styles.sectionHeading}><h3>Community reviews</h3></div>
          {!book.reviews.length && <p className={styles.muted}>No reviews yet. Be the first.</p>}
          <div className={styles.reviewList}>
            {book.reviews.map((review) => (
              <article key={review.userId} className={styles.review}>
                <div><strong>{review.userName}</strong><span aria-label={`${review.rating} out of 5 stars`}>{stars(review.rating)}</span></div>
                <p className={styles.finishStatus}>{review.finished === true ? "Finished" : review.finished === false ? "Didn’t finish" : "Finish status not recorded"}</p>
                {review.note && <p>{review.note}</p>}
              </article>
            ))}
          </div>
        </div>
      </BookClubDisclosure>

      <BookClubDisclosure
        title="Discussions"
        description="Across every meeting"
        badge={`${book.meetings.length} ${book.meetings.length === 1 ? "meeting" : "meetings"}`}
        open={discussionsOpen}
        onToggle={() => setDiscussionsOpen((value) => !value)}
      >
        {!book.meetings.length && <p className={styles.muted}>No meetings have been scheduled for this book.</p>}
        <div className={styles.meetingForums}>
          {book.meetings.map((meeting) => (
            <MeetingDiscussion
              key={meeting.id}
              meeting={meeting}
              canAdminister={canAdminister}
              initiallyOpen={focusMeetingId === meeting.id}
              focusThreadId={focusMeetingId === meeting.id ? focusThreadId : null}
            />
          ))}
        </div>
      </BookClubDisclosure>
    </div>
  );
}

export default function BookClubLibrary({
  books,
  selectedBookId,
  onSelectBook,
  onBack,
  onBooksChange,
  onAddBook,
  onEditBook,
  canAdminister,
  focusMeetingId,
  focusThreadId,
}) {
  const [query, setQuery] = useState("");
  const filteredBooks = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return books;
    return books.filter((book) => [book.title, book.author, book.bookOwnerName].filter(Boolean).some((value) => value.toLowerCase().includes(normalized)));
  }, [books, query]);
  const selected = books.find((book) => book.id === selectedBookId) ?? null;

  if (selectedBookId && !selected) {
    return <div className={styles.empty}><span aria-hidden="true">📕</span><h2>Book unavailable</h2><p>This title is no longer available in this household.</p><button type="button" className="ui-primaryButton" onClick={onBack}>View all books</button></div>;
  }
  if (selected) {
    return <BookDetail key={selected.id} book={selected} onBack={onBack} onBooksChange={onBooksChange} onEditBook={onEditBook} canAdminister={canAdminister} focusMeetingId={focusMeetingId} focusThreadId={focusThreadId} />;
  }

  return (
    <section className={styles.library} aria-label="Book library">
      <div className={styles.libraryHeading}>
        <p className={styles.libraryCount}>{books.length} {books.length === 1 ? "book" : "books"} · current, available, and completed</p>
        <div className={styles.libraryTools}>
          <button type="button" className={`ui-primaryButton ${styles.addButton}`} onClick={onAddBook}>Add book</button>
          <label className={styles.search}><span className="sr-only">Search books</span><input type="search" placeholder="Search title, author, or owner" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        </div>
      </div>
      {!books.length ? (
        <div className={styles.empty}><span aria-hidden="true">📚</span><h2>No books yet</h2><p>Add the first book, then select it when creating a meeting.</p><button type="button" className="ui-primaryButton" onClick={onAddBook}>Add the first book</button></div>
      ) : (
        <div className={styles.bookList}>
          {filteredBooks.map((book) => (
            <button type="button" className={styles.bookCard} key={book.id} onClick={() => onSelectBook(book.id)}>
              <span className={styles.bookCopy}>
                <span className={styles.cardTopline}>
                  <strong>{book.title}</strong>
                  <em>{statusLabel(book)}</em>
                </span>
                <span className={styles.bookMeta}>by {book.author} · Book owner: {book.bookOwnerName || "Former member"}</span>
                <span className={styles.bookMeta}>{bookDate(book)}</span>
              </span>
              <span className={styles.cardStats}><span>{ratingLabel(book)}</span><span>{finishedLabel(book)}</span></span>
            </button>
          ))}
          {!filteredBooks.length && <p className={styles.noMatches}>No books match “{query.trim()}”.</p>}
        </div>
      )}
    </section>
  );
}
