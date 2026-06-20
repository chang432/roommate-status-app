import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { cx } from '../utils/classNames.js'
import styles from './styling/ModalShell.module.css'

// Shared centered dialog shell used by create flows and status details. It
// closes on Escape and backdrop click so each caller only supplies content.
export default function ModalShell({
  title,
  onClose,
  children,
  widthClassName,
  contentClassName,
  ariaLabel,
}) {
  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div onClick={onClose} className={styles.backdrop}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel ?? title}
        onClick={(event) => event.stopPropagation()}
        className={cx(styles.dialog, widthClassName)}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className={styles.closeButton}
        >
          ×
        </button>
        {title ? <h2 className={styles.title}>{title}</h2> : null}
        <div className={cx(styles.content, contentClassName)}>{children}</div>
      </div>
    </div>,
    document.body,
  )
}
