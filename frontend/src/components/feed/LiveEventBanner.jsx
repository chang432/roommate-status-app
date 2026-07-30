import { useMemo } from "react";
import { relativeTime } from "../../utils/time.js";
import { cx } from "../../utils/classNames.js";
import { useConfirmDialog } from "../ui/useConfirmDialog.jsx";
import styles from "./LiveEventBanner.module.css";

export default function LiveEventBanner({
  event,
  canEnd,
  ending,
  onEnd,
  user,
  onBannerClick,
  type,
}) {
  const { confirm, confirmationDialog } = useConfirmDialog();
  const isInvolved = useMemo(() => {
    return Boolean(user && (event.memberIds ?? []).includes(user.id));
  }, [event, user]);

  async function handleEnd() {
    const label = type === "watchparty" ? "watchparty" : "activity";
    const confirmed = await confirm({
      title: `End ${event.text}?`,
      message: `This stops the live ${label} for everyone in the group.`,
      confirmLabel: `End ${label}`,
    });
    if (confirmed) onEnd();
  }

  return (
    <>
      <div
        className={cx(
          isInvolved ? styles.involvedBanner : styles.banner,
          styles.clickable,
        )}
        data-involved={isInvolved || undefined}
        data-type={type}
        role="button"
        tabIndex={0}
        // Both banner kinds render the same shape, so name them apart for screen
        // readers rather than announcing two different things identically.
        aria-label={
          type === "watchparty" ? "Open live watchparty" : "Open live activity"
        }
        onClick={onBannerClick}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onBannerClick();
          }
        }}
      >
        <div className={styles.content}>
          <span className={styles.dot} />
          <div className={styles.text}>
            <p className={styles.eyebrow}>Live now</p>
            <p className={styles.title}>{event.text}</p>
            <p className={styles.meta}>
              Started by {event.proposedBy}
              {event.liveStartedAt
                ? ` · ${relativeTime(event.liveStartedAt)}`
                : ""}
            </p>
          </div>
          {canEnd && (
            <button
              type="button"
              onKeyDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                handleEnd();
              }}
              disabled={ending}
              className={cx("ui-pillButton ui-pillDanger", styles.endButton)}
            >
              {ending ? "Ending…" : "End"}
            </button>
          )}
        </div>
      </div>
      {confirmationDialog}
    </>
  );
}
