import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { avatarColor } from "../../utils/avatar.js";
import Avatar from "./Avatar.jsx";

const POPOVER_GAP = 8;
const VIEWPORT_MARGIN = 12;

export default function PeoplePopover({
  people,
  open,
  onOpenChange,
  heading,
  dialogLabel,
  buttonLabel,
  disabled = false,
  emptyMessage = "Names unavailable",
  triggerClassName = "",
  children,
}) {
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);
  const onOpenChangeRef = useRef(onOpenChange);
  const popoverId = useId();
  const [position, setPosition] = useState(null);
  onOpenChangeRef.current = onOpenChange;

  useEffect(() => {
    if (!open) return undefined;
    function handlePointerDown(event) {
      if (
        !rootRef.current?.contains(event.target)
        && !popoverRef.current?.contains(event.target)
      ) {
        onOpenChangeRef.current(false);
      }
    }
    function handleKeyDown(event) {
      if (event.key === "Escape") onOpenChangeRef.current(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    popoverRef.current?.focus();
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open && disabled) onOpenChangeRef.current(false);
  }, [disabled, open]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return undefined;
    }
    // Portaling avoids clipping inside animated module panels.
    function updatePosition() {
      const anchor = triggerRef.current?.getBoundingClientRect();
      const popover = popoverRef.current;
      if (!anchor || !popover) return;
      const maxLeft = Math.max(
        VIEWPORT_MARGIN,
        window.innerWidth - popover.offsetWidth - VIEWPORT_MARGIN,
      );
      const left = Math.min(
        Math.max(anchor.right + POPOVER_GAP, VIEWPORT_MARGIN),
        maxLeft,
      );
      const below = anchor.bottom + POPOVER_GAP;
      const above = anchor.top - popover.offsetHeight - POPOVER_GAP;
      const preferredTop =
        below + popover.offsetHeight <= window.innerHeight - VIEWPORT_MARGIN
          ? below
          : above;
      const maxTop = Math.max(
        VIEWPORT_MARGIN,
        window.innerHeight - popover.offsetHeight - VIEWPORT_MARGIN,
      );
      setPosition({
        left,
        top: Math.min(Math.max(preferredTop, VIEWPORT_MARGIN), maxTop),
      });
    }
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, people.length]);

  const popover =
    open &&
    createPortal(
      <span
        ref={popoverRef}
        id={popoverId}
        role="dialog"
        aria-label={dialogLabel}
        tabIndex={-1}
        style={{
          left: position?.left ?? VIEWPORT_MARGIN,
          top: position?.top ?? VIEWPORT_MARGIN,
          visibility: position ? "visible" : "hidden",
        }}
        className="fixed z-50 max-h-[240px] w-max min-w-[170px] max-w-[min(260px,calc(100vw-24px))] overflow-y-auto rounded-sm border border-line bg-card p-2 shadow-card outline-none"
      >
        <span className="mb-1 block px-1 text-[10px] font-bold uppercase tracking-[0.06em] text-ink-soft">
          {heading}
        </span>
        <span className="block space-y-1">
          {people.length > 0 ? (
            people.map((person, index) => (
              <span
                key={person.id}
                className="flex items-center gap-2 rounded-sm px-1 py-1 text-[12px] text-ink"
              >
                <Avatar
                  name={person.name}
                  color={person.color ?? avatarColor(index)}
                  size={24}
                />
                <span className="truncate font-semibold">{person.name}</span>
              </span>
            ))
          ) : (
            <span className="block px-1 py-1 text-[12px] text-ink-soft">
              {emptyMessage}
            </span>
          )}
        </span>
      </span>,
      document.body,
    );

  return (
    <span ref={rootRef} className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => onOpenChange(!open)}
        disabled={disabled}
        aria-expanded={open}
        aria-controls={!disabled ? popoverId : undefined}
        aria-label={buttonLabel}
        className={triggerClassName}
      >
        {children}
      </button>
      {popover}
    </span>
  );
}
