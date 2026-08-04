import { Link } from "react-router-dom";
import { cx } from "../../utils/classNames.js";
import styles from "./BookLinkedModuleHeader.module.css";

export default function BookLinkedModuleHeader({
  expanded,
  onToggle,
  toggleLabel,
  moduleTag,
  title,
  linkTitleToBook = false,
  meta,
  bookId,
  bookTitle,
  className,
}) {
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
        {linkTitleToBook ? (
          <Link
            className={styles.titleLink}
            to={`/?book=${encodeURIComponent(bookId)}`}
            aria-label={`View ${title} in the Book Club library`}
          >
            <strong className={styles.title}>{title}</strong>
          </Link>
        ) : (
          <strong className={styles.title}>{title}</strong>
        )}
      </div>
      {!linkTitleToBook ? (
        <Link
          className={styles.bookTag}
          to={`/?book=${encodeURIComponent(bookId)}`}
          aria-label={`View ${bookTitle} in the Book Club library`}
        >
          <span className={styles.bookTagText}>{bookTitle}</span>
        </Link>
      ) : null}
      <span className={styles.meta}>{meta}</span>
    </div>
  );
}
