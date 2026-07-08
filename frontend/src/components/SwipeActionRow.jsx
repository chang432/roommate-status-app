import { useEffect, useRef, useState } from "react";
import { cx } from "../utils/classNames.js";
import styles from "./styling/SwipeActionRow.module.css";

const ACTION_WIDTH = 88;
const MIN_DRAG_TO_OPEN = 54;
const CLICK_SUPPRESSION_MS = 200;

export default function SwipeActionRow({
  actions,
  disabled = false,
  className,
  children,
}) {
  const trayWidth = Math.max(actions.length, 1) * ACTION_WIDTH;
  const containerRef = useRef(null);
  const rowRef = useRef(null);
  const pointerIdRef = useRef(null);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const gestureHandledRef = useRef(false);
  const blockClickUntilRef = useRef(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function handlePointerDown(event) {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  function handlePointerDown(event) {
    if (disabled || (event.pointerType === "mouse" && event.button !== 0)) return;
    pointerIdRef.current = event.pointerId;
    startXRef.current = event.clientX;
    startYRef.current = event.clientY;
    gestureHandledRef.current = false;
    rowRef.current?.setPointerCapture?.(event.pointerId);
  }

  function stopGesture(event) {
    if (pointerIdRef.current !== event.pointerId) return;
    pointerIdRef.current = null;
    rowRef.current?.releasePointerCapture?.(event.pointerId);
    gestureHandledRef.current = false;
  }

  function handlePointerMove(event) {
    if (pointerIdRef.current !== event.pointerId || gestureHandledRef.current) return;

    const deltaX = event.clientX - startXRef.current;
    const deltaY = event.clientY - startYRef.current;

    if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 10) {
      stopGesture(event);
      return;
    }

    if (!open && deltaX >= MIN_DRAG_TO_OPEN) {
      gestureHandledRef.current = true;
      blockClickUntilRef.current = Date.now() + CLICK_SUPPRESSION_MS;
      setOpen(true);
      return;
    }

    if (open && deltaX <= -MIN_DRAG_TO_OPEN) {
      gestureHandledRef.current = true;
      blockClickUntilRef.current = Date.now() + CLICK_SUPPRESSION_MS;
      setOpen(false);
    }
  }

  function handleClickCapture(event) {
    if (Date.now() < blockClickUntilRef.current) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (
      open &&
      !containerRef.current?.querySelector(`.${styles.actionTray}`)?.contains(event.target)
    ) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className={cx(styles.row, className)}>
      <div
        className={cx(styles.actionTray, open ? styles.actionTrayOpen : "")}
        style={{ width: `${trayWidth}px` }}
      >
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
        className={cx(styles.content, open ? styles.contentOpen : "")}
        style={{ "--swipe-offset": `${trayWidth}px` }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopGesture}
        onPointerCancel={stopGesture}
        onClickCapture={handleClickCapture}
      >
        {children}
      </div>
    </div>
  );
}
