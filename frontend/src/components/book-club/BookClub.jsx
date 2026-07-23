import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getBookClub } from "../../api/bookClub.js";
import { useAuth } from "../../context/AuthContext.jsx";
import styles from "./BookClub.module.css";

function ownerName(roommates, userId) {
  return roommates.find((member) => member.id === userId)?.name || "Former member";
}

export default function BookClub({ roommates = [], groupId, refreshToken = 0 }) {
  const { user } = useAuth();
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");

  const loadSummary = useCallback(async () => {
    try {
      const response = await getBookClub(user.id);
      setSummary(response.summary);
      setError("");
    } catch (err) {
      setError(err.message || "Could not load Book Club.");
    }
  }, [user.id]);

  useEffect(() => {
    void loadSummary();
  }, [groupId, loadSummary, refreshToken]);

  useEffect(() => {
    window.addEventListener("roomie:book-club-changed", loadSummary);
    return () => window.removeEventListener("roomie:book-club-changed", loadSummary);
  }, [loadSummary]);

  const owners = useMemo(() => {
    const bookOrder = summary?.configuration?.bookOwnerOrderUserIds ?? [];
    const snackOrder = summary?.configuration?.snackOwnerOrderUserIds ?? [];
    return {
      book: summary?.openMeeting?.bookOwnerId
        ?? summary?.activeBook?.bookOwnerId
        ?? bookOrder[0],
      snack: summary?.openMeeting?.snackOwnerId ?? snackOrder[0],
    };
  }, [summary]);

  return (
    <section className={styles.section} aria-label="Book Club">
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>Book Club</p>
          <h2>{summary?.activeBook?.title || "Choose the next read"}</h2>
          <p className={styles.muted}>
            {summary?.activeBook?.author
              ? `by ${summary.activeBook.author}`
              : "Meetings, completed books, reviews, and discussion"}
          </p>
        </div>
        <Link className={styles.openLink} to="/book-club">
          Open Book Club <span aria-hidden="true">→</span>
        </Link>
      </div>
      {error && <p className="ui-errorBox">{error}</p>}
      {summary && (
        <dl className={styles.ownerSummary}>
          <div>
            <dt>Book owner</dt>
            <dd>{owners.book ? ownerName(roommates, owners.book) : "Not assigned"}</dd>
          </div>
          <div>
            <dt>Snack owner</dt>
            <dd>{owners.snack ? ownerName(roommates, owners.snack) : "Not assigned"}</dd>
          </div>
          <div>
            <dt>Next meeting</dt>
            <dd>{summary.openMeeting ? "Scheduled" : "Ready to plan"}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}
