import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import {
  completeBookClubBook,
  getBookClub,
  getBookClubMeetings,
  getCompletedBookClubBooks,
} from "../api/bookClub.js";
import { getCurrentGroup, getGroups } from "../api/groups.js";
import { getRoommates } from "../api/roommates.js";
import BookClubLibrary from "../components/book-club/BookClubLibrary.jsx";
import BookClubMeetingFeature from "../components/book-club/BookClubMeetingFeature.jsx";
import BookClubMeetingForm from "../components/book-club/BookClubMeetingForm.jsx";
import Brandmark from "../components/ui/Brandmark.jsx";
import ModalShell from "../components/ui/ModalShell.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { cx } from "../utils/classNames.js";
import { isAdminIn } from "../utils/roles.js";
import { exactDateTime } from "../utils/time.js";
import styles from "./BookClubPage.module.css";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "meetings", label: "Meetings" },
  { id: "library", label: "Library" },
];

function ownerName(roommates, id, snapshot) {
  return roommates.find((member) => member.id === id)?.name || snapshot || "Former member";
}

export default function BookClubPage() {
  const { user, selectGroup } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const focusMeetingId = searchParams.get("meeting");
  const focusThreadId = searchParams.get("thread");
  const [activeTab, setActiveTab] = useState(focusMeetingId ? "meetings" : "overview");
  const [group, setGroup] = useState(null);
  const [roommates, setRoommates] = useState([]);
  const [summary, setSummary] = useState(null);
  const [meetings, setMeetings] = useState([]);
  const [books, setBooks] = useState([]);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formMeeting, setFormMeeting] = useState(undefined);
  const [completingBook, setCompletingBook] = useState(false);

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
    if (!ready) return;
    setLoading(true);
    try {
      const [
        { group: nextGroup },
        nextRoommates,
        { summary: nextSummary },
        { meetings: nextMeetings },
        { books: nextBooks },
      ] = await Promise.all([
        getCurrentGroup(user.id),
        getRoommates(user.id, user.activeGroupId),
        getBookClub(user.id),
        getBookClubMeetings(user.id),
        getCompletedBookClubBooks(user.id),
      ]);
      setGroup(nextGroup);
      setRoommates(nextRoommates);
      setSummary(nextSummary);
      setMeetings(nextMeetings);
      setBooks(nextBooks);
      setError("");
    } catch (err) {
      setError(err.message || "Could not load your Book Club.");
    } finally {
      setLoading(false);
    }
  }, [ready, user.activeGroupId, user.id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (focusMeetingId) setActiveTab("meetings");
  }, [focusMeetingId]);

  const canAdminister = isAdminIn(roommates, user.id);
  const bookOrder = summary?.configuration?.bookOwnerOrderUserIds ?? [];
  const snackOrder = summary?.configuration?.snackOwnerOrderUserIds ?? [];
  const currentOwners = {
    book: summary?.openMeeting?.bookOwnerId
      ?? summary?.activeBook?.bookOwnerId
      ?? bookOrder[0],
    snack: summary?.openMeeting?.snackOwnerId ?? snackOrder[0],
  };

  async function completeBook() {
    if (!summary?.activeBook || completingBook) return;
    setCompletingBook(true);
    setError("");
    try {
      await completeBookClubBook(user.id, summary.activeBook.id);
      await loadData();
    } catch (err) {
      setError(err.message || "Could not complete the current book.");
    } finally {
      setCompletingBook(false);
    }
  }

  if (!loading && group?.showBookClub === false) return <Navigate to="/" replace />;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link to="/" className={styles.homeLink} aria-label="Back to household">
          <Brandmark className={styles.brandmark} iconClassName={styles.brandmarkIcon} inverted />
        </Link>
        <div>
          <p>{group?.name || "Your group"}</p>
          <h1>Book Club</h1>
        </div>
        <Link to="/" className={styles.backLink}>Household</Link>
      </header>

      <main className={styles.main}>
        <nav className={styles.tabs} aria-label="Book Club sections">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={cx(activeTab === tab.id && styles.activeTab)}
              aria-current={activeTab === tab.id ? "page" : undefined}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
              {tab.id === "library" && books.length > 0 && <span>{books.length}</span>}
            </button>
          ))}
        </nav>

        {error && <p className="ui-errorBox">{error}</p>}
        {loading && (
          <div className={styles.loading} role="status">
            <span aria-hidden="true" />
            Loading Book Club…
          </div>
        )}

        {!loading && activeTab === "overview" && summary && (
          <div className={styles.overview}>
            <section className={styles.currentBook}>
              <p className={styles.eyebrow}>Current book</p>
              {summary.activeBook ? (
                <>
                  <h2>{summary.activeBook.title}</h2>
                  <p className={styles.author}>by {summary.activeBook.author}</p>
                  <dl>
                    <div><dt>Book owner</dt><dd>{ownerName(roommates, summary.activeBook.bookOwnerId, summary.activeBook.bookOwnerName)}</dd></div>
                    <div><dt>Selected</dt><dd>{new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(summary.activeBook.selectedAt))}</dd></div>
                  </dl>
                  {canAdminister && (
                    <button className="ui-primaryButton" type="button" onClick={completeBook} disabled={completingBook}>
                      {completingBook ? "Completing…" : "Mark book completed"}
                    </button>
                  )}
                </>
              ) : (
                <div className={styles.emptyState}>
                  <h2>No active book</h2>
                  <p>Create the next meeting to select the next read.</p>
                </div>
              )}
            </section>

            <section className={styles.nextMeeting}>
              <div className={styles.sectionHeading}>
                <div>
                  <p className={styles.eyebrow}>Next gathering</p>
                  <h2>{summary.openMeeting ? exactDateTime(summary.openMeeting.scheduledAt) : "Nothing scheduled"}</h2>
                </div>
                {summary.openMeeting && (
                  <button type="button" onClick={() => {
                    setActiveTab("meetings");
                    setSearchParams({ meeting: summary.openMeeting.id });
                  }}>Open meeting →</button>
                )}
              </div>
              {summary.openMeeting ? (
                <dl className={styles.meetingSummary}>
                  <div><dt>Reading target</dt><dd>{summary.openMeeting.readingTarget}</dd></div>
                  <div><dt>Book owner</dt><dd>{summary.openMeeting.bookOwnerName}</dd></div>
                  <div><dt>Snack owner</dt><dd>{summary.openMeeting.snackOwnerName}</dd></div>
                </dl>
              ) : canAdminister ? (
                <button className="ui-primaryButton" type="button" onClick={() => setFormMeeting(null)}>Plan a meeting</button>
              ) : (
                <p className={styles.muted}>An admin can schedule the next meeting.</p>
              )}
            </section>

            <section className={styles.ownerOrders}>
              <div className={styles.sectionHeading}>
                <div><p className={styles.eyebrow}>Owner rotation</p><h2>Who’s up next</h2></div>
              </div>
              <div className={styles.ownerColumns}>
                {[
                  ["Book", bookOrder, currentOwners.book],
                  ["Snack", snackOrder, currentOwners.snack],
                ].map(([label, order, current]) => (
                  <div key={label}>
                    <h3>{label}</h3>
                    <ol>
                      {order.map((id, index) => (
                        <li key={id} className={id === current ? styles.currentOwner : undefined}>
                          <span>{index + 1}</span>
                          <strong>{ownerName(roommates, id)}</strong>
                          {id === current && <small>Current</small>}
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
            </section>

            <button type="button" className={styles.libraryCallout} onClick={() => setActiveTab("library")}>
              <span><strong>{books.length}</strong> completed {books.length === 1 ? "book" : "books"}</span>
              <span>Browse the library and reviews →</span>
            </button>
          </div>
        )}

        {!loading && activeTab === "meetings" && (
          <section className={styles.meetings}>
            <div className={styles.pageSectionHeading}>
              <div><p className={styles.eyebrow}>Gatherings</p><h2>Meetings and forums</h2></div>
              {canAdminister && !summary?.openMeeting && (
                <button className="ui-primaryButton" type="button" onClick={() => setFormMeeting(null)}>Plan a meeting</button>
              )}
            </div>
            <BookClubMeetingFeature
              meetings={meetings}
              canAdminister={canAdminister}
              focusMeetingId={focusMeetingId}
              focusThreadId={focusThreadId}
              onEdit={setFormMeeting}
              onChanged={loadData}
            />
          </section>
        )}

        {!loading && activeTab === "library" && (
          <BookClubLibrary books={books} onBooksChange={setBooks} />
        )}
      </main>

      {formMeeting !== undefined && (
        <ModalShell title={formMeeting ? "Edit Book Club meeting" : "Plan a Book Club meeting"} onClose={() => setFormMeeting(undefined)}>
          <BookClubMeetingForm
            meeting={formMeeting}
            roommates={roommates}
            onSaved={async () => {
              setFormMeeting(undefined);
              await loadData();
              setActiveTab("meetings");
            }}
            onCancel={() => setFormMeeting(undefined)}
          />
        </ModalShell>
      )}
    </div>
  );
}
