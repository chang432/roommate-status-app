import { Link } from "react-router-dom";
import styles from "./BookClubMeetingLink.module.css";

function meetingDate(timestamp) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(Number(timestamp)));
}

export default function BookClubMeetingLink({ meeting, moduleTag }) {
  const details = [
    meeting.readingTarget,
    meeting.bookOwnerName && `Book: ${meeting.bookOwnerName}`,
    meeting.snackOwnerName && `Snacks: ${meeting.snackOwnerName}`,
  ].filter(Boolean);

  return (
    <Link
      className={styles.card}
      to={`/book-club?meeting=${encodeURIComponent(meeting.id)}`}
      aria-label={`Open Book Club meeting for ${meeting.bookTitle || "this book"}`}
    >
      <span className={styles.spine} aria-hidden="true" />
      <span className={styles.copy}>
        <span className={styles.topline}>
          {moduleTag}
          <span className={styles.status}>
            {meeting.status === "completed" ? "Completed" : "Upcoming"}
          </span>
        </span>
        <strong>{meeting.bookTitle || "Book Club meeting"}</strong>
        <span className={styles.date}>{meetingDate(meeting.scheduledAt)}</span>
        {details.length > 0 && (
          <span className={styles.details}>{details.join(" · ")}</span>
        )}
        <span className={styles.open}>
          Open meeting and discussion <span aria-hidden="true">→</span>
        </span>
      </span>
    </Link>
  );
}
