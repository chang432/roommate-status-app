import styles from "./BookClubDisclosure.module.css";

export default function BookClubDisclosure({
  title,
  description,
  badge,
  open,
  onToggle,
  children,
  className = "",
}) {
  return (
    <section
      className={`${styles.disclosure} ${className}`}
      aria-label={title}
    >
      <button
        type="button"
        className={styles.summary}
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className={styles.summaryText}>
          <span className={styles.title}>{title}</span>
          {description ? <span className={styles.description}>{description}</span> : null}
        </span>
        {badge ? <span className={styles.badge}>{badge}</span> : null}
      </button>
      <div className={`${styles.expandedRegion} ${open ? styles.expanded : styles.collapsed}`}>
        <div className={styles.expandedInner} {...(!open ? { inert: "" } : {})}>
          <div className={styles.panel}>
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}
