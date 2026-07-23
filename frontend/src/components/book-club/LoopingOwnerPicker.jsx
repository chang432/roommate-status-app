import styles from "./BookClubMeetingForm.module.css";

export default function LoopingOwnerPicker({ label, order, roommates, value, onChange, disabled }) {
  const available = order
    .map((id) => roommates.find((member) => member.id === id))
    .filter(Boolean);
  const index = Math.max(0, available.findIndex((member) => member.id === value));

  function move(direction) {
    if (!available.length || disabled) return;
    const next = (index + direction + available.length) % available.length;
    onChange(available[next].id);
  }

  return (
    <div className={styles.ownerPicker} onWheel={(event) => move(event.deltaY >= 0 ? 1 : -1)}>
      <span>{label}</span>
      <div>
        <button type="button" aria-label={`Previous ${label}`} onClick={() => move(-1)} disabled={disabled}>‹</button>
        <strong aria-live="polite">{available[index]?.name || "No member"}</strong>
        <button type="button" aria-label={`Next ${label}`} onClick={() => move(1)} disabled={disabled}>›</button>
      </div>
      <small>Tap or scroll; the order loops.</small>
    </div>
  );
}
