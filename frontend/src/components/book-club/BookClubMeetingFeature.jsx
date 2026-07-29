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

const ATTENDANCE_LABELS = {
  attending: "Attending",
  maybe: "Maybe",
  not_attending: "Not attending",
  pending: "Pending",
};

function attendanceCounts(responses) {
  return responses.reduce((counts, response) => {
    const status = response.attendanceStatus ?? "pending";
    counts[status] += 1;
    return counts;
  }, { attending: 0, maybe: 0, not_attending: 0, pending: 0 });
}

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

  async function saveResponse(meeting, changes) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await setBookClubResponse(user.id, meeting.id, changes);
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
        const responses = detail.responses || [];
        const counts = attendanceCounts(responses);
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
                    <div className={styles.responseHeading}>
                      <h3>Attendance and progress</h3>
                      <div className={styles.attendanceTotals} aria-label="Attendance totals">
                        {Object.entries(ATTENDANCE_LABELS).map(([status, label]) => (
                          <span key={status} data-status={status}>{counts[status]} {label}</span>
                        ))}
                      </div>
                    </div>
                    <div className={styles.responseColumns} aria-hidden="true">
                      <span>Member</span><span>Attendance</span><span>Progress</span>
                    </div>
                    <div className={styles.responseList} role="list" aria-label="Member attendance and progress">
                      {responses.map((response) => {
                        const mine = response.userId === user.id;
                        const editable = mine && detail.status === "scheduled";
                        const attendance = response.attendanceStatus ?? "pending";
                        return (
                          <div className={styles.response} key={response.userId} role="listitem">
                            <span className={styles.memberName} title={response.userName}>
                              {response.userName}{mine ? <small>You</small> : null}
                            </span>
                            {editable ? (
                              <select
                                className={styles.attendanceControl}
                                aria-label="Your attendance"
                                value={response.attendanceStatus ?? ""}
                                disabled={busy}
                                onChange={(event) => saveResponse(detail, { attendanceStatus: event.target.value })}
                              >
                                <option value="" disabled>Pending</option>
                                <option value="attending">Attending</option>
                                <option value="maybe">Maybe</option>
                                <option value="not_attending">Not attending</option>
                              </select>
                            ) : (
                              <span className={styles.attendanceBadge} data-status={attendance}>{ATTENDANCE_LABELS[attendance]}</span>
                            )}
                            {editable ? (
                              <span className={styles.progressControls}>
                                <select
                                  aria-label="Your reading progress mode"
                                  value={response.readingComplete ? "complete" : "chapter"}
                                  disabled={busy}
                                  onChange={(event) => saveResponse(detail, { readingComplete: event.target.value === "complete" })}
                                >
                                  <option value="chapter">Chapter</option>
                                  <option value="complete">Complete</option>
                                </select>
                                {!response.readingComplete ? (
                                  <input
                                    key={`${response.userId}-${response.chaptersReadThrough}`}
                                    aria-label="Chapters read through"
                                    type="number"
                                    min="0"
                                    defaultValue={response.chaptersReadThrough}
                                    disabled={busy}
                                    onBlur={(event) => saveResponse(detail, { chaptersReadThrough: Number(event.target.value) })}
                                  />
                                ) : null}
                              </span>
                            ) : (
                              <span className={styles.progressValue}>{response.readingComplete ? "Complete" : `Chapter ${response.chaptersReadThrough}`}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
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
