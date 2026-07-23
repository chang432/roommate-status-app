import { useCallback, useEffect, useMemo, useState } from "react";
import { completeBookClubBook, getBookClub } from "../../api/bookClub.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { isAdminIn } from "../../utils/roles.js";
import ModalShell from "../ui/ModalShell.jsx";
import styles from "./BookClub.module.css";

function ownerName(roommates, userId) {
  return roommates.find((member) => member.id === userId)?.name || "Former member";
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
          <div className={styles.listGrid}>
            <button type="button" className={styles.ownerCard} onClick={() => setOpenList("book")}>
              <span>Book</span>
              <strong>{lists.book.length ? ownerName(roommates, lists.book[0]) : "No owner yet"}</strong>
              <small>Tap to see order</small>
            </button>
            <button type="button" className={styles.ownerCard} onClick={() => setOpenList("snack")}>
              <span>Snack</span>
              <strong>{lists.snack.length ? ownerName(roommates, lists.snack[0]) : "No owner yet"}</strong>
              <small>Tap to see order</small>
            </button>
          </div>
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
        </>
      )}
      {openList && (
        <ModalShell title={openTitle} onClose={() => setOpenList(null)} contentClassName={styles.popupContent}>
          <ol className={styles.popupList}>
            {openOrder.map((memberId, index) => (
              <li className={styles.popupItem} key={memberId}>
                <strong>{ownerName(roommates, memberId)}</strong>
                <span>{index === 0 ? "Current and default owner" : `Order #${index + 1}`}</span>
              </li>
            ))}
            {!openOrder.length && <li className={styles.muted}>No members are available.</li>}
          </ol>
        </ModalShell>
      )}
    </section>
  );
}
