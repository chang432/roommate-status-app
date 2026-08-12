import { cx } from "../../utils/classNames.js";
import styles from "./SpotifyJamButton.module.css";

export default function SpotifyJamButton({ hasJam, onClick, className }) {
  const label = hasJam ? "Replace Spotify Jam" : "Share Spotify Jam";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cx("ui-iconPrimary", styles.button, className)}
    >
      <img src="/spotify.png" alt="" className={styles.icon} />
    </button>
  );
}
