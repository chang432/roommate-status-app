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
        {/* Meetings link the primary title; forums reserve a second row for the book and metadata. */}
        {linkPrimaryTitle ? (
          <BookLinkPill bookId={bookId} bookTitle={linkedBookTitle} />
        ) : (
          <div className={styles.titleStack}>
            <strong className={styles.title}>{title}</strong>
            <div className={styles.secondaryRow}>
              <BookLinkPill bookId={bookId} bookTitle={linkedBookTitle} />
              <span className={styles.inlineMeta}>{meta}</span>
            </div>
          </div>
        )}
      </div>
      {linkPrimaryTitle ? <span className={styles.meta}>{meta}</span> : null}
    </div>
  );
}
