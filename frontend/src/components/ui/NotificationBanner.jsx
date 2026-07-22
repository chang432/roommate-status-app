import styles from "./NotificationBanner.module.css";

// Shown when the available-to-hang count crosses AVAILABLE_THRESHOLD
// (utils/status.js). PROJECT.md specifies 3; this PoC uses 2.
export default function NotificationBanner({ count }) {
  return (
    <div className={styles.banner}>
      <span className={styles.dot} />
      {count} roomies are free! LETS HANG 🎉!
    </div>
  );
}
