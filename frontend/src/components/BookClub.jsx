import { useCallback, useEffect, useState } from "react";
import {
  completeBookClubSession,
  configureBookClub,
  getBookClub,
  setBookClubResponse,
  updateBookClubNextSession,
} from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";
import { isAdminIn } from "../utils/roles.js";
import styles from "./styling/BookClub.module.css";

const EASTERN_FORMAT = new Intl.DateTimeFormat("en-US", {
  weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit",
  timeZone: "America/New_York",
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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    title: "", author: "", readingTarget: "", recommendedById: "", snackDutyUserId: "",
  });

  const canAdminister = isAdminIn(roommates, user?.id);

  const loadSummary = useCallback(() => {
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
  }, [user.id]);

  useEffect(() => loadSummary(), [groupId, loadSummary]);

  useEffect(() => {
    const scheduledAt = summary?.nextSession?.scheduledAt;
    if (!scheduledAt) return undefined;
    // Keep an open app aligned with the server's lazy rollover trigger. A
    // later visit still advances the meeting if nobody had the app open.
    const timer = window.setTimeout(loadSummary, Math.max(250, scheduledAt - Date.now() + 250));
    return () => window.clearTimeout(timer);
  }, [loadSummary, summary?.nextSession?.scheduledAt]);

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

  function startEditing() {
    const book = summary?.activeBook;
    setDraft({
      title: book?.title || "",
      author: book?.author || "",
      readingTarget: summary?.nextSession?.readingTarget || "",
      recommendedById: book?.recommendedById || roommates[0]?.id || "",
      snackDutyUserId: summary?.nextSession?.snackDutyUserId || roommates[0]?.id || "",
    });
    setEditing(true);
  }

  function rotateMember(field, direction) {
    if (!roommates.length) return;
    const index = Math.max(0, roommates.findIndex((member) => member.id === draft[field]));
    const nextIndex = (index + direction + roommates.length) % roommates.length;
    setDraft({ ...draft, [field]: roommates[nextIndex].id });
  }

  async function saveNextSession(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const { summary: nextSummary } = await updateBookClubNextSession(user.id, draft);
      setSummary(nextSummary);
      setEditing(false);
    } catch (err) {
      setError(err.message || "Could not update the next meeting.");
    } finally {
      setSaving(false);
    }
  }

  async function simulateMeetingTime() {
    if (saving || !summary?.nextSession) return;
    setSaving(true);
    setError("");
    try {
      // This calls the same backend transition as the due-time summary read;
      // it is intentionally admin-only so a member cannot skip a meeting.
      const { summary: nextSummary } = await completeBookClubSession(
        user.id,
        summary.nextSession.id,
      );
      setSummary(nextSummary);
    } catch (err) {
      setError(err.message || "Could not simulate the meeting time.");
    } finally {
      setSaving(false);
    }
  }

  const recommender = roommates.find((member) => member.id === draft.recommendedById);
  const snackDutyMember = roommates.find((member) => member.id === draft.snackDutyUserId);

  return (
    <section className={styles.section} aria-label="Book Club">
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
          <div className={styles.dynamicField}><strong>Book:</strong><span>{summary.activeBook?.title || "To be chosen"} by {summary.activeBook?.author || "an admin"}</span></div>
          <div className={styles.dynamicField}><strong>Next meeting:</strong><span>{EASTERN_FORMAT.format(summary.nextSession.scheduledAt)}</span></div>
          <div className={styles.dynamicField}><strong>Chapter goal:</strong><span>{summary.nextSession.readingTarget || "To be set"}</span></div>
          <div className={styles.dynamicField}><strong>Snack duty:</strong><span>{summary.nextSession.snackDutyName}</span></div>
          {canAdminister && !editing && (
            <div className={styles.adminActions}>
              <button type="button" className={styles.editButton} onClick={startEditing}>Edit upcoming meeting</button>
              <button type="button" className={styles.testButton} disabled={saving} onClick={simulateMeetingTime}>Test: simulate meeting time</button>
            </div>
          )}
          {canAdminister && editing && (
            <form className={styles.setup} onSubmit={saveNextSession}>
              <label>Book title<input required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
              <label>Author<input required value={draft.author} onChange={(event) => setDraft({ ...draft, author: event.target.value })} /></label>
              <label>Chapter goal<input required value={draft.readingTarget} onChange={(event) => setDraft({ ...draft, readingTarget: event.target.value })} /></label>
              <div className={styles.recommender}>
                <span>Recommended by</span>
                <div>
                  <button type="button" aria-label="Previous recommender" onClick={() => rotateMember("recommendedById", -1)} disabled={saving}>←</button>
                  <strong>{recommender?.name || "Choose a member"}</strong>
                  <button type="button" aria-label="Next recommender" onClick={() => rotateMember("recommendedById", 1)} disabled={saving}>→</button>
                </div>
              </div>
              <div className={styles.recommender}>
                <span>Snack duty</span>
                <div>
                  <button type="button" aria-label="Previous snack duty member" onClick={() => rotateMember("snackDutyUserId", -1)} disabled={saving}>←</button>
                  <strong>{snackDutyMember?.name || "Choose a member"}</strong>
                  <button type="button" aria-label="Next snack duty member" onClick={() => rotateMember("snackDutyUserId", 1)} disabled={saving}>→</button>
                </div>
              </div>
              <div className={styles.editorActions}>
                <button type="submit" disabled={saving}>{saving ? "Saving…" : "Save meeting"}</button>
                <button type="button" className={styles.cancelButton} disabled={saving} onClick={() => setEditing(false)}>Cancel</button>
              </div>
            </form>
          )}
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
