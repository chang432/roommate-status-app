import { Link } from "react-router-dom";
import { cx } from "../../utils/classNames.js";
import styles from "./BookLinkedModuleHeader.module.css";

export function BookLinkPill({ bookId, bookTitle }) {
  return (
    <Link
      className={styles.bookLink}
      to={`/?book=${encodeURIComponent(bookId)}`}
      aria-label={`View ${bookTitle} in the Book Club library`}
    >
      <strong className={styles.bookLinkText}>{bookTitle}</strong>
    </Link>
  );
}

export default function BookLinkedModuleHeader({
  expanded,
  onToggle,
  toggleLabel,
  moduleTag,
  title,
  bookLinkPlacement,
  meta,
  bookId,
  className,
}) {
  const linkPrimaryTitle = bookLinkPlacement === "title";

  return (
    <div className={cx(styles.header, className)}>
      {/* The overlay keeps the whole header clickable while the linked book stays independent. */}
      <button
        type="button"
        className={styles.toggleButton}
        aria-expanded={expanded}
        aria-label={`${expanded ? "Close" : "Open"} ${toggleLabel}`}
        onClick={onToggle}
      />
      <div className={styles.titleRow}>
        {moduleTag}
        {linkPrimaryTitle ? (
          <BookLinkPill bookId={bookId} bookTitle={title} />
        ) : (
          <strong className={styles.title}>{title}</strong>
        )}
      </div>
      <span className={styles.meta}>{meta}</span>
    </div>
  );
}
