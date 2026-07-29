import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import {
  completeBookClubMeeting,
  getBookClubMeeting,
  notifyBookClubMeeting,
  setBookClubResponse,
} from "../../api/bookClub.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { useExpandOnModuleFocus } from "../../context/ModuleFocusContext.jsx";
import { exactDateTime } from "../../utils/time.js";
import ModuleEditButton from "../feed/ModuleEditButton.jsx";
import styles from "./BookClubMeetingFeature.module.css";

export default function BookClubMeetingFeature({
  meetings,
  moduleTag,
  onEdit,
  canAdminister,
  onChanged,
}) {
  const { user } = useAuth();
  const [expandedId, setExpandedId] = useState(null);
  const [details, setDetails] = useState({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const loadMeetingDetails = useCallback(async (meetingId) => {
    try {
      const response = await getBookClubMeeting(user.id, meetingId);
      setDetails((current) => ({ ...current, [meetingId]: response.meeting }));
    } catch (err) {
      setError(err.message || "Could not load meeting details.");
    }
  }, [user.id]);

  const expandFocusedMeeting = useCallback((meetingId) => {
    setExpandedId(meetingId);
    // Notification deep links bypass the header click, so load full detail here.
    void loadMeetingDetails(meetingId);
  }, [loadMeetingDetails]);
  useExpandOnModuleFocus(expandFocusedMeeting);

  async function toggle(meeting) {
    if (expandedId === meeting.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(meeting.id);
    setError("");
    await loadMeetingDetails(meeting.id);
  }

  async function saveResponse(meeting, response, changes) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await setBookClubResponse(
        user.id,
        meeting.id,
        changes.attendanceStatus ?? response.attendanceStatus,
        changes.chaptersReadThrough ?? response.chaptersReadThrough,
      );
      setDetails((current) => ({ ...current, [meeting.id]: result.meeting }));
    } catch (err) {
      setError(err.message || "Could not save your meeting plan.");
    } finally {
      setBusy(false);
    }
  }

  async function complete(meeting) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await completeBookClubMeeting(user.id, meeting.id);
      window.dispatchEvent(new Event("roomie:book-club-changed"));
      await onChanged();
    } catch (err) {
      setError(err.message || "Could not complete the meeting.");
    } finally {
      setBusy(false);
    }
  }

  async function notify(meeting) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await notifyBookClubMeeting(user.id, meeting.id);
    } catch (err) {
      setError(err.message || "Could not send the reminder.");
    } finally {
      setBusy(false);
    }
  }

  if (!meetings.length) return null;

  return (
    <div className={styles.list}>
      {error && <p className="ui-errorBox">{error}</p>}
      {meetings.map((meeting) => {
        const detail = details[meeting.id] || meeting;
        const expanded = expandedId === meeting.id;
        return (
          <article key={meeting.id} className={styles.card}>
            <button
              type="button"
              className={styles.header}
              aria-expanded={expanded}
              onClick={() => toggle(meeting)}
            >
              <span className={styles.headerText}>
                <span className={styles.title}>{meeting.bookTitle}</span>
                <span className={styles.meta}>{exactDateTime(meeting.scheduledAt)} · Snacks: {meeting.snackOwnerName}</span>
              </span>
              {moduleTag}
            </button>
            <div className={`${styles.expandedRegion} ${expanded ? styles.expanded : styles.collapsed}`}>
              <div className={styles.expandedInner} {...(!expanded ? { inert: "" } : {})}>
                <div className={styles.detailsPanel}>
                  <p className={styles.bookTitle}>{detail.bookTitle} by {detail.bookAuthor}</p>
                  <dl className={styles.details}>
                    <div><dt>Reading target</dt><dd>{detail.readingTarget}</dd></div>
                    <div><dt>Book owner</dt><dd>{detail.bookOwnerName}</dd></div>
                    <div><dt>Snack owner</dt><dd>{detail.snackOwnerName}</dd></div>
                  </dl>
                  <div className={styles.responses}>
                    <h3>Attendance and progress</h3>
                    {(detail.responses || []).map((response) => {
                      const mine = response.userId === user.id;
                      return (
                        <div className={styles.response} key={response.userId}>
                          <span>{response.userName}</span>
                          {mine && detail.status === "scheduled" ? (
                            <span className={styles.responseControls}>
                              <select aria-label="Your attendance" value={response.attendanceStatus} disabled={busy} onChange={(event) => saveResponse(detail, response, { attendanceStatus: event.target.value })}>
                                <option value="attending">Attending</option>
                                <option value="maybe">Maybe</option>
                                <option value="not_attending">Not attending</option>
                              </select>
                              <input aria-label="Chapters read through" type="number" min="0" defaultValue={response.chaptersReadThrough} disabled={busy} onBlur={(event) => saveResponse(detail, response, { chaptersReadThrough: Number(event.target.value) })} />
                            </span>
                          ) : <span>{response.attendanceStatus.replace("_", " ")} · chapter {response.chaptersReadThrough}</span>}
                        </div>
                      );
                    })}
                  </div>
                  <div className={styles.meetingActions}>
                    <Link to={`/?book=${encodeURIComponent(meeting.bookId)}&meeting=${encodeURIComponent(meeting.id)}`}>Forum</Link>
                    {detail.status === "scheduled" && (
                      <>
                        <button type="button" disabled={busy} onClick={() => notify(detail)}>Send reminder</button>
                        <ModuleEditButton onEdit={onEdit} disabled={busy} />
                        {canAdminister && (
                          <button type="button" disabled={busy} onClick={() => complete(detail)}>Complete meeting</button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
