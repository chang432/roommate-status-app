import { useState } from "react";
import { createCounter } from "../../api/counters.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { cx } from "../../utils/classNames.js";
import { fromDateTimeLocal, toDateTimeLocal } from "../../utils/time.js";
import styles from "./CounterForm.module.css";

export default function CounterCreateForm({ onCountersChange, onSuccess, onCancel }) {
  const { user } = useAuth();
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState("automatic");
  const [occurredAt, setOccurredAt] = useState(() => toDateTimeLocal(Date.now()));
  const [initialValue, setInitialValue] = useState("0");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    const timestamp = fromDateTimeLocal(occurredAt);
    const startingValue = Number(initialValue);
    if (!title.trim() || sending) return;
    if (mode === "automatic" && (!timestamp || timestamp > Date.now())) {
      setError("Choose an incident time that is not in the future.");
      return;
    }
    if (mode === "manual" && (!Number.isSafeInteger(startingValue) || startingValue < 0)) {
      setError("Starting value must be a whole number of zero or more.");
      return;
    }
    setSending(true);
    setError("");
    try {
      await createCounter({
        title: title.trim(),
        mode,
        createdById: user.id,
        ...(mode === "automatic"
          ? { occurredAt: timestamp }
          : { initialValue: startingValue }),
        note: note.trim(),
      });
      await onCountersChange();
      onSuccess?.();
    } catch (requestError) {
      setError(requestError.message || "Could not create the counter.");
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={submit} className={styles.form}>
      <fieldset className={styles.modeFieldset} disabled={sending}>
        <legend className={styles.fieldLabel}>Counter type</legend>
        <div className={styles.modeOptions}>
          <label className={cx(styles.modeOption, mode === "automatic" && styles.modeSelected)}>
            <input type="radio" name="counter-mode" value="automatic" checked={mode === "automatic"} onChange={() => setMode("automatic")} />
            <span><strong>Days since</strong><small>Updates automatically after an incident.</small></span>
          </label>
          <label className={cx(styles.modeOption, mode === "manual" && styles.modeSelected)}>
            <input type="radio" name="counter-mode" value="manual" checked={mode === "manual"} onChange={() => setMode("manual")} />
            <span><strong>Manual count</strong><small>Roommates adjust the total together.</small></span>
          </label>
        </div>
      </fieldset>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Counter name</span>
        <input className={cx("ui-textInput", styles.input)} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={280} placeholder={mode === "automatic" ? "Days since the last spill" : "Plants watered"} disabled={sending} />
      </label>

      {mode === "automatic" ? (
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Last incident</span>
          <input type="datetime-local" step="60" max={toDateTimeLocal(Date.now())} className={cx("ui-textInput", styles.input)} value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} disabled={sending} />
        </label>
      ) : (
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Starting value</span>
          <input type="number" min="0" step="1" className={cx("ui-textInput", styles.input)} value={initialValue} onChange={(event) => setInitialValue(event.target.value)} disabled={sending} />
        </label>
      )}

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Starting note <span>(optional)</span></span>
        <input className={cx("ui-textInput", styles.input)} value={note} onChange={(event) => setNote(event.target.value)} maxLength={280} placeholder="Add a little context" disabled={sending} />
      </label>

      {error && <p className="ui-errorText">{error}</p>}
      <div className="ui-formActions">
        <button type="button" className="ui-secondaryButton ui-formActionButton" onClick={onCancel} disabled={sending}>Cancel</button>
        <button type="submit" className="ui-primaryButton ui-formActionButton" disabled={sending || !title.trim()}>{sending ? "Creating…" : "Create counter"}</button>
      </div>
    </form>
  );
}
