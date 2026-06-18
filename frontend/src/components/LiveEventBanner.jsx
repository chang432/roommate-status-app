import { useMemo } from "react";
import { relativeTime } from "../utils/time.js";
import { cx } from "../utils/classNames.js";
import styles from "./styling/LiveEventBanner.module.css";

export default function LiveEventBanner({
  event,
  canEnd,
  ending,
  onEnd,
  user,
  onBannerClick,
}) {
  const isInvolved = useMemo(() => {
    return Boolean(user && (event.memberIds ?? []).includes(user.id));
  }, [event, user]);

  return (
    <div
      className={cx(
        isInvolved ? styles.involvedBanner : styles.banner,
        !isInvolved && styles.clickable,
      )}
      data-involved={isInvolved || undefined}
      role={isInvolved ? undefined : "button"}
      tabIndex={isInvolved ? undefined : 0}
      aria-label={isInvolved ? undefined : "Open live activity"}
      onClick={onBannerClick}
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
            onClick={(event) => {
              event.stopPropagation();
              onEnd();
            }}
            disabled={ending}
            className={cx("ui-pillButton ui-pillDanger", styles.endButton)}
          >
            {ending ? "Ending…" : "End event"}
          </button>
        )}
      </div>
    </div>
  );
}
