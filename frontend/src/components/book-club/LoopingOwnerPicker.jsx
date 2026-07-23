import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import styles from "./BookClubMeetingForm.module.css";

const ITEM_HEIGHT = 44;
const COPY_COUNT = 5;
const MIDDLE_COPY = 2;
const SCROLL_SETTLE_MS = 100;
const WHEEL_STEP_THRESHOLD = 20;

export default function LoopingOwnerPicker({
  label,
  order,
  roommates,
  value,
  onChange,
  disabled,
  expanded,
  onExpandedChange,
}) {
  const listId = useId();
  const listRef = useRef(null);
  const settleTimerRef = useRef(null);
  const wheelDeltaRef = useRef(0);
  const [activeRepeatIndex, setActiveRepeatIndex] = useState(0);
  const available = useMemo(
    () => order
      .map((id) => roommates.find((member) => member.id === id))
      .filter(Boolean),
    [order, roommates],
  );
  const selectedIndex = Math.max(
    0,
    available.findIndex((member) => member.id === value),
  );
  const repeated = useMemo(() => {
    if (available.length <= 1) {
      return available.map((member, repeatIndex) => ({ member, repeatIndex }));
    }
    return Array.from(
      { length: available.length * COPY_COUNT },
      (_, repeatIndex) => ({
        member: available[repeatIndex % available.length],
        repeatIndex,
      }),
    );
  }, [available]);

  function middleIndex(memberIndex = selectedIndex) {
    return available.length <= 1
      ? memberIndex
      : available.length * MIDDLE_COPY + memberIndex;
  }

  function positionAt(repeatIndex, behavior = "auto") {
    const list = listRef.current;
    if (!list) return;
    const top = repeatIndex * ITEM_HEIGHT;
    if (typeof list.scrollTo === "function") {
      list.scrollTo({ top, behavior });
    } else {
      list.scrollTop = top;
    }
    setActiveRepeatIndex(repeatIndex);
  }

  useLayoutEffect(() => {
    if (!expanded || !available.length) return;
    const target = available.length <= 1
      ? selectedIndex
      : available.length * MIDDLE_COPY + selectedIndex;
    const list = listRef.current;
    if (list) list.scrollTop = target * ITEM_HEIGHT;
    setActiveRepeatIndex(target);
  }, [available.length, expanded, selectedIndex]);

  useEffect(() => () => {
    window.clearTimeout(settleTimerRef.current);
  }, []);

  useEffect(() => {
    if (!expanded) window.clearTimeout(settleTimerRef.current);
  }, [expanded]);

  function commitRepeatIndex(repeatIndex) {
    const entry = repeated[repeatIndex];
    if (!entry) return;
    if (entry.member.id !== value) onChange(entry.member.id);
    // Recenter on an equivalent middle copy so the wheel can keep looping.
    positionAt(middleIndex(repeatIndex % available.length));
  }

  function handleScroll() {
    const list = listRef.current;
    if (!list || !repeated.length) return;
    const repeatIndex = Math.max(
      0,
      Math.min(repeated.length - 1, Math.round(list.scrollTop / ITEM_HEIGHT)),
    );
    setActiveRepeatIndex(repeatIndex);
    window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = window.setTimeout(
      () => commitRepeatIndex(repeatIndex),
      SCROLL_SETTLE_MS,
    );
  }

  function move(direction) {
    if (disabled || available.length < 2) return;
    const nextIndex = (
      selectedIndex + direction + available.length
    ) % available.length;
    onChange(available[nextIndex].id);
  }

  function handleWheel(event) {
    if (disabled || available.length < 2) return;
    event.preventDefault();
    wheelDeltaRef.current += event.deltaY;
    if (Math.abs(wheelDeltaRef.current) < WHEEL_STEP_THRESHOLD) return;
    move(wheelDeltaRef.current > 0 ? 1 : -1);
    wheelDeltaRef.current = 0;
  }

  function handleKeyDown(event) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      move(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Escape") {
      onExpandedChange(false);
    }
  }

  const selectedMember = available[selectedIndex];
  const activeOptionId = repeated[activeRepeatIndex]
    ? `${listId}-option-${activeRepeatIndex}`
    : undefined;

  return (
    <div className={styles.ownerPicker}>
      <button
        type="button"
        className={styles.ownerPickerToggle}
        aria-expanded={expanded}
        aria-controls={listId}
        disabled={disabled || !available.length}
        onClick={() => onExpandedChange(!expanded)}
      >
        <span>{label}</span>
        <strong>{selectedMember?.name || "No member"}</strong>
        <span aria-hidden="true">{expanded ? "▴" : "▾"}</span>
      </button>
      {expanded && available.length > 0 && (
        <>
          <div className={styles.wheelFrame}>
            <div
              ref={listRef}
              id={listId}
              className={styles.wheelViewport}
              role="listbox"
              tabIndex={0}
              aria-label={label}
              aria-activedescendant={activeOptionId}
              onScroll={handleScroll}
              onWheel={handleWheel}
              onKeyDown={handleKeyDown}
            >
              {repeated.map(({ member, repeatIndex }) => {
                const selected = repeatIndex === activeRepeatIndex;
                return (
                  <button
                    key={`${member.id}-${repeatIndex}`}
                    id={`${listId}-option-${repeatIndex}`}
                    type="button"
                    role="option"
                    tabIndex={-1}
                    aria-selected={selected}
                    className={[
                      styles.wheelOption,
                      selected ? styles.wheelOptionSelected : "",
                    ].filter(Boolean).join(" ")}
                    onClick={() => {
                      onChange(member.id);
                      positionAt(middleIndex(repeatIndex % available.length), "smooth");
                    }}
                  >
                    {member.name}
                  </button>
                );
              })}
            </div>
          </div>
          <small>Scroll or tap a nearby member. The order loops.</small>
        </>
      )}
    </div>
  );
}
