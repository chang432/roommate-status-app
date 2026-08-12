import styles from "./SettingsMenu.module.css";

export default function SettingsMenu({ label, children }) {
  return <nav aria-label={label} className={styles.menu}>{children}</nav>;
}

export function SettingsMenuButton({
  title,
  description,
  onClick,
  danger = false,
  disclosure = true,
  buttonRef,
  screenId,
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      className={`${styles.row} ${danger ? styles.danger : ""}`}
      data-settings-screen-id={screenId}
    >
      <span className={styles.copy}>
        <strong>{title}</strong>
        {description ? <small>{description}</small> : null}
      </span>
      {disclosure ? <span className={styles.chevron} aria-hidden="true">›</span> : null}
    </button>
  );
}
