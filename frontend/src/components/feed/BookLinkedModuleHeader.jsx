import { Link } from "react-router-dom";
import { cx } from "../../utils/classNames.js";
import styles from "./BookLinkedModuleHeader.module.css";

function BookLinkPill({ bookId, bookTitle }) {
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
  bookTitle,
  className,
}) {
  const linkPrimaryTitle = bookLinkPlacement === "title";
  const linkedBookTitle = linkPrimaryTitle ? title : bookTitle;

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
          <BookLinkPill bookId={bookId} bookTitle={linkedBookTitle} />
        ) : (
          <strong className={styles.title}>{title}</strong>
        )}
      </div>
      {linkPrimaryTitle ? (
        <span className={styles.meta}>{meta}</span>
      ) : (
        <>
          <span className={styles.meta}>{meta}</span>
          <div className={styles.bookRow}>
            <BookLinkPill bookId={bookId} bookTitle={linkedBookTitle} />
          </div>
        </>
      )}
    </div>
  );
}
