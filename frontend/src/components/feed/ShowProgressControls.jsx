import { useRef, useState } from "react";
import { initialOf } from "../../utils/avatar.js";
import styles from "./ShowTrackerFeature.module.css";

const PROGRESS_LONG_PRESS_MS = 1000;

// A single progress chip: tapping increments immediately, while a long press
// opens inline numeric editing for an exact season/episode jump.
function CounterChip({
  label,
  shortLabel,
  name,
  noun,
  value,
  busy,
  readOnly,
  onIncrement,
  onSet,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const pressTimer = useRef(null);
  // Guards against onBlur double-firing after Enter/Escape already finished.
  const finished = useRef(false);
  // A long press should open the editor without also triggering the tap bump.
  const suppressClick = useRef(false);

  function beginEdit() {
    finished.current = false;
    suppressClick.current = true;
    setDraft(String(value));
    setEditing(true);
  }

  function startPress() {
    if (busy || readOnly) return;
    cancelPress();
    pressTimer.current = setTimeout(beginEdit, PROGRESS_LONG_PRESS_MS);
  }

  function cancelPress() {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }

  // apply=true commits the typed value; apply=false discards it.
  function finishEdit(apply) {
    if (finished.current) return;
    finished.current = true;
    setEditing(false);
    if (!apply) return;
    const next = Number.parseInt(draft, 10);
    if (Number.isNaN(next) || next === value) return;
    onSet(Math.max(1, next));
  }

  return (
    <div className={styles.counter}>
      <span className={styles.counterLabel}>{label}</span>
      <div className={styles.counterValue}>
        {editing ? (
          <input
            type="number"
            min="1"
            inputMode="numeric"
            autoFocus
            value={draft}
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => finishEdit(true)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                finishEdit(true);
              } else if (event.key === "Escape") {
                event.preventDefault();
                finishEdit(false);
              }
            }}
            className={styles.counterInput}
            aria-label={`Set ${name}'s ${noun}`}
          />
        ) : (
          <button
            type="button"
            disabled={busy || readOnly}
            className={readOnly ? styles.counterStatic : styles.counterChip}
            title={
              readOnly
                ? `${label} ${value}`
                : `Tap to advance ${noun}; long-press to edit`
            }
            onPointerDown={startPress}
            onPointerUp={cancelPress}
            onPointerLeave={cancelPress}
            onPointerCancel={cancelPress}
            onClick={(event) => {
              event.stopPropagation();
              cancelPress();
              if (suppressClick.current) {
                suppressClick.current = false;
                return;
              }
              if (!readOnly) onIncrement();
            }}
          >
            <span className={styles.counterChipLabel}>{shortLabel}</span>
            <span className={styles.counterChipValue}>{value}</span>
          </button>
        )}
      </div>
    </div>
  );
}

// Watcher sub-entry: roommate name plus independent season and episode counters.
// Edits are open to everyone, so no ownership check gates the controls. A
// completed show renders read-only, so its watchers show progress without the
// increment/edit/remove controls.
export default function WatcherRow({
  member,
  busy,
  readOnly,
  onAdjust,
  onSetProgress,
  onRemove,
}) {
  return (
    <li className={styles.watcher}>
      <div className={styles.watcherHead}>
        <span className={styles.watcherAvatar} title={member.name}>
          {initialOf(member.name)}
        </span>
        <p className={styles.watcherName}>{member.name}</p>
        <div className={styles.counters}>
          <CounterChip
            label="Season"
            shortLabel="S"
            noun="season"
            name={member.name}
            value={member.season}
            busy={busy}
            readOnly={readOnly}
            onIncrement={() => onAdjust(member, "season", 1)}
            onSet={(value) => onSetProgress(member, "season", value)}
          />
          <CounterChip
            label="Episode"
            shortLabel="E"
            noun="episode"
            name={member.name}
            value={member.episode}
            busy={busy}
            readOnly={readOnly}
            onIncrement={() => onAdjust(member, "episode", 1)}
            onSet={(value) => onSetProgress(member, "episode", value)}
          />
        </div>
        {!readOnly && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onRemove(member)}
            className={styles.watcherRemove}
            aria-label={`Remove ${member.name} from this show`}
            title="Remove watcher"
          >
            ×
          </button>
        )}
      </div>
    </li>
  );
}

