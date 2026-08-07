import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cx } from "../../utils/classNames.js";
import styles from "./BottomTray.module.css";

const DISMISS_DISTANCE = 96;
const DISMISS_VELOCITY = 0.5;

export default function BottomTray({ title, onClose, children, widthClassName, ariaLabel }) {
  const dialogRef = useRef(null);
  const dragRef = useRef(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.querySelector("button, input, select, textarea, [tabindex]:not([tabindex='-1'])")?.focus();

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...dialogRef.current.querySelectorAll(
        "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])",
      )];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus?.();
    };
  }, [onClose]);

  function handlePointerDown(event) {
    // Controls in the draggable header must retain their native click target;
    // pointer capture would otherwise redirect the X button's pointer-up.
    if (event.target.closest("button, input, select, textarea, a")) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      lastY: event.clientY,
      lastAt: performance.now(),
      velocity: 0,
      offset: 0,
    };
    setDragging(true);
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic pointer events used by assistive tooling may not own an
      // active browser pointer; the drag still works while events stay local.
    }
  }

  function handlePointerMove(event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const now = performance.now();
    const elapsed = Math.max(1, now - drag.lastAt);
    drag.velocity = (event.clientY - drag.lastY) / elapsed;
    drag.lastY = event.clientY;
    drag.lastAt = now;
    drag.offset = Math.max(0, event.clientY - drag.startY);
    setDragOffset(drag.offset);
  }

  function finishDrag(event) {
    const drag = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (
      drag &&
      drag.pointerId === event.pointerId &&
      (drag.offset >= DISMISS_DISTANCE || (drag.offset >= 30 && drag.velocity >= DISMISS_VELOCITY))
    ) {
      onClose();
      return;
    }
    setDragOffset(0);
  }

  return createPortal(
    <div className={styles.layer}>
      <button type="button" className={styles.backdrop} onClick={onClose} aria-label="Close settings" />
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel ?? title}
        className={cx(styles.tray, widthClassName, dragging && styles.dragging)}
        style={{ transform: dragOffset ? `translateY(${dragOffset}px)` : undefined }}
      >
        <header
          className={styles.header}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
        >
          <span className={styles.handle} aria-hidden="true" />
          <h2 className={styles.title}>{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className={styles.closeButton}>
            ×
          </button>
        </header>
        <div className={styles.content}>{children}</div>
      </section>
    </div>,
    document.body,
  );
}
