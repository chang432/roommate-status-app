import { cx } from "../../utils/classNames.js";
import styles from "./ExpandableCardRegion.module.css";

export default function ExpandableCardRegion({
  expanded,
  className,
  children,
}) {
  return (
    <div
      className={cx(
        styles.region,
        expanded ? styles.expanded : styles.collapsed,
      )}
    >
      <div className={styles.inner} {...(!expanded ? { inert: "" } : {})}>
        <div className={className}>{children}</div>
      </div>
    </div>
  );
}
