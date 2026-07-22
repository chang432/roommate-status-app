import { useEffect, useState } from "react";
import { configureBookClub, getBookClub, setBookClubResponse } from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";
import { isAdminIn } from "../utils/roles.js";
import styles from "./styling/BookClub.module.css";

const EASTERN_FORMAT = new Intl.DateTimeFormat("en-US", {
  weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit",
  timeZone: "America/New_York", timeZoneName: "short",
});

// This intentionally owns only the Book Club card. Its group-level visibility
// remains the responsibility of StatusPage, so disabling the toggle removes
// this whole feature without affecting its stored history.
export default function BookClub({ roommates = [], groupId }) {
  const { user } = useAuth();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [setup, setSetup] = useState({ title: "", author: "", readingTarget: "" });

  const canAdminister = isAdminIn(roommates, user?.id);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getBookClub(user.id)
      .then(({ summary: nextSummary }) => {
        if (!cancelled) {
          setSummary(nextSummary);
          setError("");
        }
      })
      .catch((err) => !cancelled && setError(err.message || "Could not load Book Club."))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [groupId, user.id]);

  async function submitSetup(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const { summary: nextSummary } = await configureBookClub(user.id, setup);
      setSummary(nextSummary);
    } catch (err) {
      setError(err.message || "Could not configure Book Club.");
    } finally {
      setSaving(false);
    }
  }

  async function updateResponse(response, changes) {
    if (saving || !summary?.nextSession) return;
    setSaving(true);
    setError("");
    try {
      const { summary: nextSummary } = await setBookClubResponse(
        user.id,
        summary.nextSession.id,
        changes.attendanceStatus ?? response.attendanceStatus ?? "attending",
        changes.chaptersReadThrough ?? response.chaptersReadThrough ?? 0,
      );
      setSummary(nextSummary);
    } catch (err) {
      setError(err.message || "Could not save your reading update.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={styles.section} aria-label="Book Club">
      <div className={styles.heading}>
        <p className={styles.title}>Book Club</p>
        <span className={styles.timezone}>Eastern time</span>
      </div>
      {loading && <p className={styles.muted}>Loading Book Club…</p>}
      {error && <p className="ui-errorBox">{error}</p>}
      {!loading && !summary && (
        canAdminister ? (
          <form className={styles.setup} onSubmit={submitSetup}>
            <p>Start the club with the first book and reading target.</p>
            <label>Book title<input required value={setup.title} onChange={(event) => setSetup({ ...setup, title: event.target.value })} /></label>
            <label>Author<input required value={setup.author} onChange={(event) => setSetup({ ...setup, author: event.target.value })} /></label>
            <label>First reading target<input required placeholder="Read through Chapter 8" value={setup.readingTarget} onChange={(event) => setSetup({ ...setup, readingTarget: event.target.value })} /></label>
            <button type="submit" disabled={saving}>{saving ? "Saving…" : "Set up Book Club"}</button>
          </form>
        ) : <p className={styles.muted}>An admin has not configured Book Club yet.</p>
      )}
      {summary && (
        <div className={styles.summary}>
          <p className={styles.meeting}>Next meeting: {EASTERN_FORMAT.format(summary.nextSession.scheduledAt)}</p>
          <p><strong>{summary.activeBook?.title}</strong> by {summary.activeBook?.author}</p>
          <p className={styles.muted}>Recommended by {summary.activeBook?.recommendedByName}</p>
          <dl className={styles.details}>
            <div><dt>Reading</dt><dd>{summary.nextSession.readingTarget}</dd></div>
            <div><dt>Snacks</dt><dd>{summary.nextSession.snackDutyName}</dd></div>
          </dl>
          <div className={styles.responses}>
            <p className={styles.responsesTitle}>Meeting plans</p>
            {summary.nextSession.responses.map((response) => {
              const mine = response.userId === user.id;
              return <div className={styles.response} key={response.userId}>
                <span>{response.userName}</span>
                {mine ? <span className={styles.responseControls}>
                  <select aria-label="Your attendance" value={response.attendanceStatus || ""} disabled={saving} onChange={(event) => updateResponse(response, { attendanceStatus: event.target.value })}>
                    <option value="" disabled>Not responded</option><option value="attending">Attending</option><option value="maybe">Maybe</option><option value="not_attending">Not attending</option>
                  </select>
                  <input aria-label="Chapters read through" type="number" min="0" defaultValue={response.chaptersReadThrough ?? ""} disabled={saving} placeholder="Chapters" onBlur={(event) => event.target.value !== "" && updateResponse(response, { chaptersReadThrough: Number(event.target.value) })} />
                </span> : <span className={styles.muted}>{response.attendanceStatus ? `${response.attendanceStatus.replace("_", " ")} · through chapter ${response.chaptersReadThrough}` : "Not responded"}</span>}
              </div>;
            })}
          </div>
        </div>
      )}
    </section>
  );
}
