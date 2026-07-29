import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  completeBookClubBook,
  getBookClub,
  getBookClubBooks,
} from "../../api/bookClub.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { isAdminIn } from "../../utils/roles.js";
import ModalShell from "../ui/ModalShell.jsx";
import BookClubLibrary from "./BookClubLibrary.jsx";
import styles from "./BookClub.module.css";

function ownerName(roommates, userId) {
  return roommates.find((member) => member.id === userId)?.name || "Former member";
}

function ownerOrderLabel(index, memberId, currentOwnerId) {
  const isCurrent = memberId === currentOwnerId;
  const isDefault = index === 0;
  if (isCurrent && isDefault) return "Current and default owner";
  if (isCurrent) return "Current owner";
  if (isDefault) return "Default owner";
  return `Order #${index + 1}`;
}

function CardCopy({ label, value, hint }) {
  return (
    <>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </>
  );
}

export default function BookClub({ roommates = [], groupId, refreshToken = 0 }) {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedBookId = searchParams.get("book");
  const linkedMeetingId = searchParams.get("meeting");
  const linkedThreadId = searchParams.get("thread");
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openList, setOpenList] = useState(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState("");
  const [books, setBooks] = useState([]);
  const [selectedBookId, setSelectedBookId] = useState(null);
  const [completingBook, setCompletingBook] = useState(false);
  const canAdminister = isAdminIn(roommates, user?.id);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getBookClub(user.id);
      setSummary(response.summary);
      setError("");
    } catch (err) {
      setError(err.message || "Could not load Book Club.");
    } finally {
      setLoading(false);
    }
  }, [user.id]);

  const loadBooks = useCallback(async () => {
    setLibraryLoading(true);
    try {
      const response = await getBookClubBooks(user.id);
      setBooks(response.books);
      setLibraryError("");
    } catch (err) {
      setLibraryError(err.message || "Could not load the Book Club library.");
    } finally {
      setLibraryLoading(false);
    }
  }, [user.id]);

  useEffect(() => {
    void loadSummary();
  }, [groupId, loadSummary, refreshToken]);

  useEffect(() => {
    function onChanged() {
      void loadSummary();
      if (libraryOpen) void loadBooks();
    }
    window.addEventListener("roomie:book-club-changed", onChanged);
    return () => window.removeEventListener("roomie:book-club-changed", onChanged);
  }, [libraryOpen, loadBooks, loadSummary]);

  useEffect(() => {
    if (!linkedBookId) return;
    setLibraryOpen(true);
    setSelectedBookId(linkedBookId);
    void loadBooks();
  }, [groupId, linkedBookId, loadBooks]);

  const lists = useMemo(() => ({
    book: summary?.configuration?.bookOwnerOrderUserIds ?? [],
    snack: summary?.configuration?.snackOwnerOrderUserIds ?? [],
  }), [summary]);
  const currentOwners = useMemo(() => ({
    // Meeting snapshots are authoritative; list heads are only future defaults.
    book: summary?.openMeeting?.bookOwnerId
      ?? summary?.activeBook?.bookOwnerId
      ?? lists.book[0],
    snack: summary?.openMeeting?.snackOwnerId ?? lists.snack[0],
  }), [lists, summary]);

  async function openLibrary(bookId = null) {
    setSelectedBookId(bookId);
    setLibraryOpen(true);
    await loadBooks();
  }

  function clearLibraryParams() {
    const next = new URLSearchParams(searchParams);
    next.delete("book");
    next.delete("meeting");
    next.delete("thread");
    setSearchParams(next, { replace: true });
  }

  function closeLibrary() {
    setLibraryOpen(false);
    setSelectedBookId(null);
    clearLibraryParams();
  }

  function showBookList() {
    setSelectedBookId(null);
    clearLibraryParams();
  }

  async function completeBook() {
    if (!summary?.activeBook || completingBook) return;
    setCompletingBook(true);
    setError("");
    try {
      const response = await completeBookClubBook(user.id, summary.activeBook.id);
      setSummary(response.summary);
      if (libraryOpen) await loadBooks();
    } catch (err) {
      setError(err.message || "Could not complete the current book.");
    } finally {
      setCompletingBook(false);
    }
  }

  const openOrder = openList ? lists[openList] : [];
  const openTitle = openList === "book" ? "Book owner order" : "Snack owner order";
  const activeBook = summary?.activeBook;

  return (
    <section className={styles.section} aria-label="Book Club">
      {error && <p className="ui-errorBox">{error}</p>}
      {loading ? <p className={styles.muted}>Loading Book Club…</p> : (
        <div className={styles.cardGrid}>
          <div className={styles.currentCard}>
            <button
              type="button"
              className={styles.cardMain}
              disabled={!activeBook}
              onClick={() => openLibrary(activeBook?.id)}
            >
              <CardCopy
                label="Current book"
                value={activeBook?.title || "No book selected"}
                hint={activeBook?.author ? `by ${activeBook.author}` : "Choose one with the next meeting"}
              />
            </button>
            {activeBook && canAdminister && (
              <button className={styles.completeButton} type="button" disabled={completingBook} onClick={completeBook}>
                {completingBook ? "Completing…" : "Complete book"}
              </button>
            )}
          </div>
          <button type="button" className={styles.card} onClick={() => openLibrary()}>
            <CardCopy label="Past books" value="Book library" hint="Ratings, reviews, and discussions" />
          </button>
          <button type="button" className={styles.card} onClick={() => setOpenList("book")}>
            <CardCopy
              label="Book"
              value={currentOwners.book ? ownerName(roommates, currentOwners.book) : "No owner yet"}
              hint="Tap to see order"
            />
          </button>
          <button type="button" className={styles.card} onClick={() => setOpenList("snack")}>
            <CardCopy
              label="Snack"
              value={currentOwners.snack ? ownerName(roommates, currentOwners.snack) : "No owner yet"}
              hint="Tap to see order"
            />
          </button>
        </div>
      )}
      {openList && (
        <ModalShell title={openTitle} onClose={() => setOpenList(null)} contentClassName={styles.popupContent}>
          <ol className={styles.popupList}>
            {openOrder.map((memberId, index) => (
              <li className={styles.popupItem} key={memberId}>
                <strong>{ownerName(roommates, memberId)}</strong>
                <span>{ownerOrderLabel(index, memberId, currentOwners[openList])}</span>
              </li>
            ))}
            {!openOrder.length && <li className={styles.muted}>No members are available.</li>}
          </ol>
        </ModalShell>
      )}
      {libraryOpen && (
        <ModalShell
          title={selectedBookId ? "Book details" : "Book library"}
          onClose={closeLibrary}
          widthClassName={styles.libraryDialog}
          contentClassName={styles.libraryContent}
        >
          {libraryError && <p className="ui-errorBox">{libraryError}</p>}
          {libraryLoading && <p className={styles.libraryState}>Loading books…</p>}
          {!libraryLoading && !libraryError && (
            <BookClubLibrary
              books={books}
              selectedBookId={selectedBookId}
              onSelectBook={setSelectedBookId}
              onBack={showBookList}
              onBooksChange={setBooks}
              canAdminister={canAdminister}
              focusMeetingId={linkedMeetingId}
              focusThreadId={linkedThreadId}
            />
          )}
        </ModalShell>
      )}
    </section>
  );
}
