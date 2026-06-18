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
      className={isInvolved ? styles.involvedBanner : styles.banner}
      data-involved={isInvolved || undefined}
      onClick={() => onBannerClick(isInvolved)}
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
            onClick={onEnd}
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
