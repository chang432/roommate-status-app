import { useCallback, useState } from "react";
import {
  completeBookClubMeeting,
  getBookClubMeeting,
  notifyBookClubMeeting,
  setBookClubResponse,
} from "../../api/bookClub.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { useExpandOnModuleFocus } from "../../context/ModuleFocusContext.jsx";
import { avatarColor } from "../../utils/avatar.js";
import { exactDateTime } from "../../utils/time.js";
import ModuleEditButton from "../feed/ModuleEditButton.jsx";
import BookLinkedModuleHeader from "../feed/BookLinkedModuleHeader.jsx";
import ExpandableCardRegion from "../feed/ExpandableCardRegion.jsx";
import Avatar from "../ui/Avatar.jsx";
import PeoplePopover from "../ui/PeoplePopover.jsx";
import { useConfirmDialog } from "../ui/useConfirmDialog.jsx";
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
  const [openAttendanceStatus, setOpenAttendanceStatus] = useState(null);
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
      setOpenAttendanceStatus(null);
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
      message: "Attendance will become read-only.",
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
  // Preserve each member's avatar color when an RSVP moves them between rows.
  const responseAvatarColors = new Map(
    responses.map((response, index) => [response.userId, avatarColor(index)]),
  );
  const attendanceEditable =
    Boolean(viewerResponse) && detail.status === "scheduled";
  const meetingDateTime = exactDateTime(meeting.scheduledAt);

  return (
    <div className={styles.list}>
      {error && <p className="ui-errorBox">{error}</p>}
      <article className={styles.card}>
        <BookLinkedModuleHeader
          className={styles.header}
          expanded={expanded}
          onToggle={() => toggle(meeting)}
          toggleLabel={`Book Club meeting for ${meeting.bookTitle}, ${meetingDateTime}, ${meeting.readingTarget}`}
          moduleTag={moduleTag}
          title={meeting.bookTitle}
          linkTitleToBook
          meta={`${meetingDateTime} · ${meeting.readingTarget}`}
          bookId={meeting.bookId}
        />
        <ExpandableCardRegion
          expanded={expanded}
          className={styles.detailsPanel}
        >
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
          <section className={styles.attendanceSection} aria-label="Attendance">
            <div className={styles.attendanceContent}>
              {attendanceEditable ? (
                <label className={styles.attendanceEditor}>
                  <span>RSVP</span>
                  <select
                    aria-label="RSVP"
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
                  const people = members.map((response) => ({
                    id: response.userId,
                    name: response.userName,
                    color: responseAvatarColors.get(response.userId),
                  }));
                  const peopleLabel = `${members.length} ${members.length === 1 ? "person" : "people"}`;
                  return (
                    <section
                      className={styles.attendanceGroup}
                      key={status}
                      data-status={status}
                      aria-label={`${label}: ${members.length}`}
                    >
                      <div className={styles.attendanceGroupRow}>
                        <span
                          className={styles.attendanceIndicator}
                          data-attendance-status-indicator={status}
                          aria-hidden="true"
                        />
                        <span className={styles.attendanceGroupSummary}>
                          <span className={styles.attendanceGroupLabel}>
                            {label}
                          </span>
                          <span className={styles.attendanceGroupCount}>
                            {members.length}
                          </span>
                        </span>
                        {members.length ? (
                          <span className={styles.attendancePeople}>
                            <PeoplePopover
                              people={people}
                              open={openAttendanceStatus === status}
                              onOpenChange={(open) =>
                                setOpenAttendanceStatus(open ? status : null)
                              }
                              heading={label}
                              dialogLabel={`${label} members`}
                              buttonLabel={`View ${peopleLabel} marked ${label.toLowerCase()}`}
                              triggerClassName={styles.attendanceTrigger}
                            >
                              <span
                                className={styles.attendanceAvatarCluster}
                                aria-hidden="true"
                              >
                                {people.map((person) => (
                                  <Avatar
                                    key={person.id}
                                    name={person.name}
                                    color={person.color}
                                    size={28}
                                    className={styles.attendanceAvatar}
                                  />
                                ))}
                                {members.length > 4 ? (
                                  <span className={styles.attendanceMoreDesktop}>
                                    +{members.length - 4}
                                  </span>
                                ) : null}
                                {members.length > 3 ? (
                                  <span className={styles.attendanceMoreMobile}>
                                    +{members.length - 3}
                                  </span>
                                ) : null}
                              </span>
                            </PeoplePopover>
                          </span>
                        ) : null}
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>
          </section>
          {detail.status === "scheduled" && (
            <div className={`ui-moduleActionRow ${styles.meetingActions}`}>
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
            </div>
          )}
        </ExpandableCardRegion>
      </article>
      {confirmationDialog}
    </div>
  );
}
