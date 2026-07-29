import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import {
  getBookClubMeeting,
  getCompletedBookClubBooks,
} from "../api/bookClub.js";
import { getCurrentGroup, getGroups } from "../api/groups.js";
import BookClubForum from "../components/book-club/BookClubForum.jsx";
import BookClubLibrary from "../components/book-club/BookClubLibrary.jsx";
import Brandmark from "../components/ui/Brandmark.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { exactDateTime } from "../utils/time.js";
import styles from "./BookClubPage.module.css";

export default function BookClubPage({ view = "library" }) {
  const { user, selectGroup } = useAuth();
  const activeGroupId = user.activeGroupId;
  const [searchParams, setSearchParams] = useSearchParams();
  const meetingId = searchParams.get("meeting");
  const focusThreadId = searchParams.get("thread");
  const [group, setGroup] = useState(null);
  const [books, setBooks] = useState([]);
  const [meeting, setMeeting] = useState(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    async function resolveGroup() {
      try {
        const { groups } = await getGroups(user.id);
        if (!current) return;
        const requested = searchParams.get("groupId");
        const requestedGroup = groups.find((item) => item.groupId === requested);
        if (requestedGroup && requestedGroup.groupId !== user.activeGroupId) {
          selectGroup(requestedGroup.groupId);
          return;
        }
        if (requested) {
          const next = new URLSearchParams(searchParams);
          next.delete("groupId");
          setSearchParams(next, { replace: true });
        }
        setReady(true);
      } catch (err) {
        if (current) {
          setError(err.message || "Could not load your Book Club.");
          setLoading(false);
        }
      }
    }
    void resolveGroup();
    return () => {
      current = false;
    };
  }, [searchParams, selectGroup, setSearchParams, user.activeGroupId, user.id]);

  const loadData = useCallback(async () => {
    if (!ready || !activeGroupId) return;
    setLoading(true);
    try {
      const groupRequest = getCurrentGroup(user.id);
      if (view === "forum") {
        if (!meetingId) throw new Error("Choose a meeting to open its forum.");
        const [{ group: nextGroup }, { meeting: nextMeeting }] = await Promise.all([
          groupRequest,
          getBookClubMeeting(user.id, meetingId),
        ]);
        setGroup(nextGroup);
        setMeeting(nextMeeting);
      } else {
        const [{ group: nextGroup }, { books: nextBooks }] = await Promise.all([
          groupRequest,
          getCompletedBookClubBooks(user.id),
        ]);
        setGroup(nextGroup);
        setBooks(nextBooks);
      }
      setError("");
    } catch (err) {
      setError(err.message || `Could not load the Book Club ${view}.`);
    } finally {
      setLoading(false);
    }
  }, [activeGroupId, meetingId, ready, user.id, view]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  if (!loading && group?.showBookClub === false) return <Navigate to="/" replace />;

  const title = view === "forum" ? "Meeting forum" : "Library";
  const contextLabel = group?.name === "Book Club"
    ? "Book Club"
    : `${group?.name || "Your group"} · Book Club`;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link to="/" className={styles.homeLink} aria-label="Back to household">
          <Brandmark className={styles.brandmark} iconClassName={styles.brandmarkIcon} inverted />
        </Link>
        <div>
          <p>{contextLabel}</p>
          <h1>{title}</h1>
        </div>
        <Link to="/" className={styles.backLink}>Household</Link>
      </header>

      <main className={styles.main}>
        {error && <p className="ui-errorBox">{error}</p>}
        {loading && (
          <div className={styles.loading} role="status">
            <span aria-hidden="true" />
            Loading {title.toLowerCase()}…
          </div>
        )}

        {!loading && view === "library" && !error && (
          <BookClubLibrary books={books} onBooksChange={setBooks} />
        )}

        {!loading && view === "forum" && meeting && !error && (
          <div className={styles.forumLayout}>
            <section className={styles.meetingSummary}>
              <p className={styles.eyebrow}>Discussion for</p>
              <h2>{meeting.bookTitle}</h2>
              <p>{meeting.bookAuthor} · {exactDateTime(meeting.scheduledAt)}</p>
              <dl>
                <div><dt>Reading target</dt><dd>{meeting.readingTarget}</dd></div>
                <div><dt>Book owner</dt><dd>{meeting.bookOwnerName}</dd></div>
                <div><dt>Snack owner</dt><dd>{meeting.snackOwnerName}</dd></div>
              </dl>
            </section>
            <BookClubForum
              meeting={meeting}
              canAdminister={Boolean(group?.viewerIsAdmin)}
              focusThreadId={focusThreadId}
            />
          </div>
        )}
      </main>
    </div>
  );
}
