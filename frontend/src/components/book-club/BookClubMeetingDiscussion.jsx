import { useEffect, useState } from "react";
import { exactDateTime } from "../../utils/time.js";
import BookClubDisclosure from "./BookClubDisclosure.jsx";
import BookClubForum from "./BookClubForum.jsx";

export default function BookClubMeetingDiscussion({
  meeting,
  canAdminister,
  focusThreadId = null,
  initiallyOpen = false,
  title,
  description,
  badge,
  className = "",
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [hasOpened, setHasOpened] = useState(initiallyOpen);

  useEffect(() => {
    if (initiallyOpen) {
      setOpen(true);
      setHasOpened(true);
    }
  }, [initiallyOpen]);

  function toggle() {
    setOpen((value) => {
      // Historical discussions can be numerous, so defer their API reads until needed.
      if (!value) setHasOpened(true);
      return !value;
    });
  }

  const disclosureTitle = title ?? exactDateTime(meeting.scheduledAt);
  const disclosureDescription = description
    ?? (meeting.status === "scheduled" ? "Open meeting" : "Completed meeting");
  const disclosureBadge = badge === undefined ? meeting.readingTarget : badge;

  return (
    <BookClubDisclosure
      className={className}
      title={disclosureTitle}
      description={disclosureDescription}
      badge={disclosureBadge}
      open={open}
      onToggle={toggle}
    >
      {hasOpened ? (
        <BookClubForum
          meeting={meeting}
          canAdminister={canAdminister}
          focusThreadId={focusThreadId}
        />
      ) : null}
    </BookClubDisclosure>
  );
}
