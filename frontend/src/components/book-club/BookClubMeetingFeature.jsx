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
import ExpandableCardRegion from "../feed/ExpandableCardRegion.jsx";
import { useConfirmDialog } from "../ui/useConfirmDialog.jsx";
import BookClubDisclosure from "./BookClubDisclosure.jsx";
import BookClubMeetingDiscussion from "./BookClubMeetingDiscussion.jsx";
import styles from "./BookClubMeetingFeature.module.css";

const ATTENDANCE_OPTIONS = [
  { status: "attending", label: "Attending" },
  { status: "maybe", label: "Maybe" },
  { status: "not_attending", label: "Not attending" },
  { status: "pending", label: "Pending" },
];

function groupAttendance(responses) {
  return responses.reduce(
    (groups, response) => {
      const status = response.attendanceStatus ?? "pending";
      groups[status].push(response);
      return groups;
    },
    { attending: [], maybe: [], not_attending: [], pending: [] },
  );
}

export default function BookClubMeetingFeature({
  meeting,
  moduleTag,
  onEdit,
  canAdminister,
  onChanged,
}) {
  const { user } = useAuth();
  const [expandedId, setExpandedId] = useState(null);
  const [details, setDetails] = useState({});
  const [attendanceOpen, setAttendanceOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { confirm, confirmationDialog } = useConfirmDialog();

  const loadMeetingDetails = useCallback(
    async (meetingId) => {
      try {
        const response = await getBookClubMeeting(user.id, meetingId);
        setDetails((current) => ({
          ...current,
          [meetingId]: response.meeting,
        }));
      } catch (err) {
        setError(err.message || "Could not load meeting details.");
      }
    },
    [user.id],
  );

  const expandFocusedMeeting = useCallback(
    (meetingId) => {
      setExpandedId(meetingId);
      // Notification deep links bypass the header click, so load full detail here.
      void loadMeetingDetails(meetingId);
    },
    [loadMeetingDetails],
  );
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
    const confirmed = await confirm({
      title: `Complete meeting for ${meeting.bookTitle}?`,
      message:
        "Attendance will become read-only, and the meeting discussion will close.",
      confirmLabel: "Complete meeting",
    });
    if (!confirmed) return;
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

  const detail = details[meeting.id] || meeting;
  const expanded = expandedId === meeting.id;
  const responses = detail.responses || [];
  const attendanceGroups = groupAttendance(responses);
  const viewerResponse = responses.find(
    (response) => response.userId === user.id,
  );
  const attendanceEditable =
    Boolean(viewerResponse) && detail.status === "scheduled";

  return (
    <div className={styles.list}>
      {error && <p className="ui-errorBox">{error}</p>}
      <article className={styles.card}>
        <button
          type="button"
          className={styles.header}
          aria-expanded={expanded}
          onClick={() => toggle(meeting)}
        >
          <span className={styles.headerText}>
            <span className={styles.title}>{meeting.bookTitle}</span>
            <span className={styles.meta}>
              {exactDateTime(meeting.scheduledAt)} · Snacks:{" "}
              {meeting.snackOwnerName}
            </span>
          </span>
          {moduleTag}
        </button>
        <ExpandableCardRegion
          expanded={expanded}
          className={styles.detailsPanel}
        >
          <p className={styles.bookTitle}>
            {detail.bookTitle} by {detail.bookAuthor}
          </p>
          <dl className={styles.details}>
            <div>
              <dt>Reading target</dt>
              <dd>{detail.readingTarget}</dd>
            </div>
            <div>
              <dt>Book owner</dt>
              <dd>{detail.bookOwnerName}</dd>
            </div>
            <div>
              <dt>Snack owner</dt>
              <dd>{detail.snackOwnerName}</dd>
            </div>
          </dl>
          <BookClubDisclosure
            className={styles.meetingSection}
            title="Attendance"
            description="Your RSVP and household responses"
            badge={`${responses.length} ${responses.length === 1 ? "member" : "members"}`}
            open={attendanceOpen}
            onToggle={() => setAttendanceOpen((value) => !value)}
          >
            <div className={styles.attendanceContent}>
              {attendanceEditable ? (
                <label className={styles.attendanceEditor}>
                  <span>Your attendance</span>
                  <select
                    aria-label="Your attendance"
                    value={viewerResponse.attendanceStatus ?? ""}
                    disabled={busy}
                    onChange={(event) =>
                      saveResponse(detail, {
                        attendanceStatus: event.target.value,
                      })
                    }
                  >
                    <option value="" disabled>
                      Pending
                    </option>
                    <option value="attending">Attending</option>
                    <option value="maybe">Maybe</option>
                    <option value="not_attending">Not attending</option>
                  </select>
                </label>
              ) : null}
              <div
                className={styles.attendanceGroups}
                aria-label="Member attendance"
              >
                {ATTENDANCE_OPTIONS.map(({ status, label }) => {
                  const members = attendanceGroups[status];
                  return (
                    <section
                      className={styles.attendanceGroup}
                      data-status={status}
                      key={status}
                      aria-label={`${label}: ${members.length}`}
                    >
                      <header className={styles.attendanceGroupHeader}>
                        <h4>
                          <span
                            aria-hidden="true"
                            className={styles.attendanceIndicator}
                          />
                          {label}
                        </h4>
                        <span
                          aria-label={`${members.length} ${members.length === 1 ? "member" : "members"}`}
                        >
                          {members.length}
                        </span>
                      </header>
                      {members.length ? (
                        <ul className={styles.memberList}>
                          {members.map((response) => (
                            <li key={response.userId}>
                              <span title={response.userName}>
                                {response.userName}
                              </span>
                              {response.userId === user.id ? (
                                <small>You</small>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className={styles.emptyGroup}>No one yet</p>
                      )}
                    </section>
                  );
                })}
              </div>
            </div>
          </BookClubDisclosure>
          <BookClubMeetingDiscussion
            meeting={detail}
            canAdminister={canAdminister}
            className={styles.meetingSection}
            title="Discussion"
            description="Topics and replies for this meeting"
            badge={null}
          />
          <div className={`ui-moduleActionRow ${styles.meetingActions}`}>
            <Link
              className="ui-pillButton ui-pillSecondary ui-moduleActionButton"
              to={`/?book=${encodeURIComponent(meeting.bookId)}`}
            >
              View book
            </Link>
            {detail.status === "scheduled" && (
              <>
                <button
                  type="button"
                  className="ui-pillButton ui-pillSecondary ui-moduleActionButton"
                  disabled={busy}
                  onClick={() => notify(detail)}
                >
                  Send reminder
                </button>
                <ModuleEditButton onEdit={onEdit} disabled={busy} />
                {canAdminister && (
                  <button
                    type="button"
                    className="ui-pillButton ui-pillDanger ui-moduleActionButton"
                    disabled={busy}
                    onClick={() => complete(detail)}
                  >
                    Complete meeting
                  </button>
                )}
              </>
            )}
          </div>
        </ExpandableCardRegion>
      </article>
      {confirmationDialog}
    </div>
  );
}
