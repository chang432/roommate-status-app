import { useEffect, useMemo, useRef, useState } from "react";
import { cx } from "../utils/classNames.js";
import styles from "./styling/SwipeActionRow.module.css";

const ACTION_WIDTH = 88;
const MIN_DRAG_TO_OPEN = 42;
const CLICK_SUPPRESSION_MS = 200;

export default function SwipeActionRow({
  actions,
  disabled = false,
  className,
  children,
}) {
  const trayWidth = Math.max(actions.length, 1) * ACTION_WIDTH;
  const rowRef = useRef(null);
  const pointerIdRef = useRef(null);
  const startXRef = useRef(0);
  const draggingRef = useRef(false);
  const blockClickUntilRef = useRef(0);
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);

  const visibleOffset = useMemo(() => (open ? trayWidth : 0), [open, trayWidth]);

  useEffect(() => {
    setOffset(visibleOffset);
  }, [visibleOffset]);

  useEffect(() => {
    function handlePointerDown(event) {
      if (!rowRef.current?.contains(event.target)) setOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  function clampOffset(value) {
    return Math.max(0, Math.min(trayWidth, value));
  }

  function handlePointerDown(event) {
    if (disabled || event.pointerType === "mouse" && event.button !== 0) return;
    pointerIdRef.current = event.pointerId;
    startXRef.current = event.clientX - offset;
    draggingRef.current = false;
    rowRef.current?.setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event) {
    if (pointerIdRef.current !== event.pointerId) return;
    const nextOffset = clampOffset(event.clientX - startXRef.current);
    if (Math.abs(nextOffset - offset) > 6) draggingRef.current = true;
    setOffset(nextOffset);
  }

  function finishGesture(event) {
    if (pointerIdRef.current !== event.pointerId) return;
    pointerIdRef.current = null;
    rowRef.current?.releasePointerCapture?.(event.pointerId);
    if (draggingRef.current) {
      blockClickUntilRef.current = Date.now() + CLICK_SUPPRESSION_MS;
      setOpen(offset >= MIN_DRAG_TO_OPEN);
    } else {
      setOffset(visibleOffset);
    }
    draggingRef.current = false;
  }

  function handleClickCapture(event) {
    if (Date.now() < blockClickUntilRef.current) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (open && !rowRef.current?.querySelector(`.${styles.actionTray}`)?.contains(event.target)) {
      setOpen(false);
    }
  }

  return (
    <div className={cx(styles.row, className)}>
      <div className={styles.actionTray} style={{ width: `${trayWidth}px` }}>
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setOpen(false);
              action.onClick();
            }}
            disabled={action.disabled}
            className={cx(
              styles.action,
              action.tone === "danger" ? styles.actionDanger : styles.actionPrimary,
            )}
          >
            {action.pendingLabel ?? action.label}
          </button>
        ))}
      </div>
      <div
        ref={rowRef}
        className={styles.content}
        style={{ transform: `translateX(${offset}px)` }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishGesture}
        onPointerCancel={finishGesture}
        onClickCapture={handleClickCapture}
      >
        {children}
      </div>
    </div>
  );
}
