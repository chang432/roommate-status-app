import { useCallback, useEffect, useMemo, useState } from "react";
import { completeBookClubBook, getBookClub } from "../../api/bookClub.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { isAdminIn } from "../../utils/roles.js";
import ModalShell from "../ui/ModalShell.jsx";
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

export default function BookClub({ roommates = [], groupId, refreshToken = 0 }) {
  const { user } = useAuth();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openList, setOpenList] = useState(null);
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

  useEffect(() => {
    loadSummary();
  }, [groupId, loadSummary, refreshToken]);

  useEffect(() => {
    window.addEventListener("roomie:book-club-changed", loadSummary);
    return () => window.removeEventListener("roomie:book-club-changed", loadSummary);
  }, [loadSummary]);

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

  async function completeBook() {
    if (!summary?.activeBook || completingBook) return;
    setCompletingBook(true);
    setError("");
    try {
      const response = await completeBookClubBook(user.id, summary.activeBook.id);
      setSummary(response.summary);
    } catch (err) {
      setError(err.message || "Could not complete the current book.");
    } finally {
      setCompletingBook(false);
    }
  }

  const openOrder = openList ? lists[openList] : [];
  const openTitle = openList === "book" ? "Book owner order" : "Snack owner order";

  return (
    <section className={styles.section} aria-label="Book Club owner lists">
      {error && <p className="ui-errorBox">{error}</p>}
      {loading ? <p className={styles.muted}>Loading owner lists…</p> : (
        <>
          {summary?.activeBook && (
            <div className={styles.activeBook}>
              <span>Current book: <strong>{summary.activeBook.title}</strong></span>
              {canAdminister && (
                <button type="button" disabled={completingBook} onClick={completeBook}>
                  {completingBook ? "Completing…" : "Complete book"}
                </button>
              )}
            </div>
          )}
          <div className={styles.listGrid}>
            <button type="button" className={styles.ownerCard} onClick={() => setOpenList("book")}>
              <span>Book</span>
              <strong>{currentOwners.book ? ownerName(roommates, currentOwners.book) : "No owner yet"}</strong>
              <small>Tap to see order</small>
            </button>
            <button type="button" className={styles.ownerCard} onClick={() => setOpenList("snack")}>
              <span>Snack</span>
              <strong>{currentOwners.snack ? ownerName(roommates, currentOwners.snack) : "No owner yet"}</strong>
              <small>Tap to see order</small>
            </button>
          </div>
        </>
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
    </section>
  );
}
