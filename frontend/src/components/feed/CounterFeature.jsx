import { useCallback, useEffect, useState } from "react";
import {
  addCounterEntry,
  archiveCounter,
  deleteCounter,
  deleteCounterEntry,
  getCounter,
  restoreCounter,
  updateCounterEntry,
} from "../../api/counters.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { useExpandOnModuleFocus } from "../../context/ModuleFocusContext.jsx";
import { cx } from "../../utils/classNames.js";
import {
  completedDaysSince,
  counterValueLabel,
  dateInTimeZone,
  formatCounterDate,
} from "../../utils/counters.js";
import { useConfirmDialog } from "../ui/useConfirmDialog.jsx";
import ExpandableCardRegion from "./ExpandableCardRegion.jsx";
import ModuleEditButton from "./ModuleEditButton.jsx";
import styles from "./CounterFeature.module.css";

function HistoryEditor({ entry, timeZone, busy, onSave, onCancel }) {
  const [occurredDate, setOccurredDate] = useState(entry.occurredDate);
  const [note, setNote] = useState(entry.note ?? "");
  const [delta, setDelta] = useState(entry.delta ?? 1);
  const [value, setValue] = useState(entry.value ?? 0);

  return (
    <form
      className={styles.historyEditor}
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          note: note.trim(),
          ...(entry.kind === "baseline"
            ? { value: Number(value) }
            : { occurredDate }),
          ...(entry.kind === "adjustment" ? { delta: Number(delta) } : {}),
        });
      }}
    >
      {entry.kind !== "baseline" && (
        <label><span>Date</span><input type="date" max={dateInTimeZone(Date.now(), timeZone)} className="ui-textInput" value={occurredDate} onChange={(event) => setOccurredDate(event.target.value)} required /></label>
      )}
      {entry.kind === "adjustment" && (
        <label><span>Change</span><select className="ui-textInput" value={delta} onChange={(event) => setDelta(event.target.value)}><option value="1">Increase by 1</option><option value="-1">Decrease by 1</option></select></label>
      )}
      {entry.kind === "baseline" && (
        <label><span>Starting value</span><input type="number" min="0" step="1" className="ui-textInput" value={value} onChange={(event) => setValue(event.target.value)} required /></label>
      )}
      <label className={styles.noteField}><span>Note (optional)</span><input className="ui-textInput" maxLength={280} value={note} onChange={(event) => setNote(event.target.value)} /></label>
      <div className={styles.editorActions}>
        <button type="button" className="ui-pillButton ui-pillSecondary" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" className="ui-pillButton ui-pillPrimary" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </form>
  );
}

function historyLabel(entry, mode, currentDays) {
  if (entry.kind === "baseline") return `Started at ${entry.resultingValue}`;
  if (mode === "manual") {
    return `${entry.delta > 0 ? "+1" : "−1"} · count ${entry.resultingValue}`;
  }
  if (entry.daysUntilNext === undefined) return `Current streak · ${currentDays} day${currentDays === 1 ? "" : "s"}`;
  return `${entry.daysUntilNext} day${entry.daysUntilNext === 1 ? "" : "s"} until next incident`;
}

export default function CounterFeature({ counter, moduleTag, onCountersChange, onEdit }) {
  const { user } = useAuth();
  const [expandedId, setExpandedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [incidentDate, setIncidentDate] = useState(() => dateInTimeZone(Date.now(), counter.timeZone));
  const [editingId, setEditingId] = useState(null);
  const [today, setToday] = useState(() => dateInTimeZone(Date.now(), counter.timeZone));
  const { confirm, confirmationDialog } = useConfirmDialog();
  useExpandOnModuleFocus(setExpandedId);

  const expanded = expandedId === counter.id;
  const liveValue = counter.mode === "automatic"
    ? completedDaysSince(counter.lastIncidentDate, today)
    : counter.currentValue;

  useEffect(() => {
    if (counter.mode !== "automatic") return undefined;
    const refresh = () => setToday(dateInTimeZone(Date.now(), counter.timeZone));
    const interval = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [counter.lastIncidentDate, counter.mode, counter.timeZone]);

  useEffect(() => {
    setToday(dateInTimeZone(Date.now(), counter.timeZone));
  }, [counter.timeZone]);

  const loadDetail = useCallback(async (cursor = "", append = false) => {
    setLoading(true);
    setError("");
    try {
      const loaded = await getCounter(counter.id, user.id, cursor);
      setDetail((current) => append && current
        ? { ...loaded, entries: [...current.entries, ...loaded.entries] }
        : loaded);
    } catch (requestError) {
      setError(requestError.message || "Could not load counter history.");
    } finally {
      setLoading(false);
    }
  }, [counter.id, user.id]);

  useEffect(() => {
    if (expanded && !detail && !loading && !error) loadDetail();
  }, [detail, error, expanded, loadDetail, loading]);

  async function mutate(key, operation, reloadDetail = true) {
    if (busy) return false;
    setBusy(key);
    setError("");
    try {
      await operation();
      await onCountersChange();
      if (expanded && reloadDetail) await loadDetail();
      return true;
    } catch (requestError) {
      setError(requestError.message || "Could not update the counter.");
      return false;
    } finally {
      setBusy("");
    }
  }

  async function adjust(delta) {
    const saved = await mutate(`adjust-${delta}`, () => addCounterEntry(counter.id, {
      userId: user.id,
      delta,
      occurredDate: dateInTimeZone(Date.now(), counter.timeZone),
      note: note.trim(),
    }));
    if (saved) setNote("");
  }

  async function logIncident(event) {
    event.preventDefault();
    const todayDate = dateInTimeZone(Date.now(), counter.timeZone);
    if (!incidentDate || incidentDate > todayDate) {
      setError("Choose an incident date that is not in the future.");
      return;
    }
    const saved = await mutate("incident", () => addCounterEntry(counter.id, {
      userId: user.id,
      occurredDate: incidentDate,
      note: note.trim(),
    }));
    if (saved) {
      setNote("");
      setIncidentDate(dateInTimeZone(Date.now(), counter.timeZone));
    }
  }

  async function removeEntry(entry) {
    const confirmed = await confirm({
      title: "Delete this history entry?",
      message: "The counter and every later running total will be recalculated.",
      confirmLabel: "Delete entry",
    });
    if (confirmed) await mutate(`delete-entry-${entry.id}`, () => deleteCounterEntry(counter.id, entry.id, user.id));
  }

  async function removeCounter() {
    const confirmed = await confirm({
      title: `Delete ${counter.title}?`,
      message: "This permanently removes the counter and all of its history.",
      confirmLabel: "Delete counter",
    });
    if (confirmed) await mutate("delete-counter", () => deleteCounter(counter.id, user.id), false);
  }

  return (
    <div className={styles.wrap}>
      {error && <p className={cx("ui-errorText", styles.error)}>{error}</p>}
      <article className={cx(styles.card, counter.isArchived && styles.archived)}>
        <button type="button" className={styles.summary} aria-expanded={expanded} onClick={() => {
          if (expanded) {
            setExpandedId(null);
          } else {
            setExpandedId(counter.id);
            if (!detail) loadDetail();
          }
        }}>
          <span className={styles.summaryText}>
            <span className={styles.titleRow}>{moduleTag}<strong className={styles.title}>{counter.title}</strong></span>
            <span className={styles.meta}>{counter.mode === "automatic" ? `Days since last incident · Last incident ${formatCounterDate(counter.lastIncidentDate)}` : "Manual counter"}</span>
          </span>
          <span className={styles.value}>{counterValueLabel(counter.mode, liveValue)}</span>
        </button>

        <ExpandableCardRegion expanded={expanded} className={styles.panel}>
          {!counter.isArchived && counter.mode === "automatic" && (
            <form className={styles.incidentForm} onSubmit={logIncident}>
              <label><span>Incident date</span><input type="date" max={dateInTimeZone(Date.now(), counter.timeZone)} className="ui-textInput" value={incidentDate} onChange={(event) => setIncidentDate(event.target.value)} /></label>
              <label className={styles.noteField}><span>Note (optional)</span><input className="ui-textInput" maxLength={280} value={note} onChange={(event) => setNote(event.target.value)} placeholder="What happened?" /></label>
              <button type="submit" className="ui-pillButton ui-pillPrimary" disabled={Boolean(busy)}>{busy === "incident" ? "Logging…" : "Log incident"}</button>
            </form>
          )}

          {!counter.isArchived && counter.mode === "manual" && (
            <div className={styles.manualControls}>
              <label className={styles.noteField}><span>Note for the next update (optional)</span><input className="ui-textInput" maxLength={280} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add context" /></label>
              <div className={styles.stepper}>
                <button type="button" onClick={() => adjust(-1)} disabled={Boolean(busy) || liveValue === 0} aria-label={`Decrease ${counter.title}`}>−</button>
                <output aria-live="polite"><strong>{liveValue}</strong><span>current count</span></output>
                <button type="button" onClick={() => adjust(1)} disabled={Boolean(busy)} aria-label={`Increase ${counter.title}`}>+</button>
              </div>
            </div>
          )}

          <section className={styles.history} aria-label="Counter history">
            <div className={styles.historyHeader}><h4>History</h4>{loading && <span>Loading…</span>}</div>
            {!loading && detail?.entries.length === 0 && <p className={styles.empty}>No history yet.</p>}
            {detail?.entries.length > 0 && (
              <ol>
                {detail.entries.map((entry) => (
                  <li key={entry.id}>
                    {editingId === entry.id ? (
                      <HistoryEditor
                        entry={entry}
                        timeZone={counter.timeZone}
                        busy={busy === `edit-${entry.id}`}
                        onCancel={() => setEditingId(null)}
                        onSave={async (changes) => {
                          const saved = await mutate(`edit-${entry.id}`, () => updateCounterEntry(counter.id, entry.id, user.id, changes));
                          if (saved) setEditingId(null);
                        }}
                      />
                    ) : (
                      <>
                        <div className={styles.historyCopy}>
                          <strong>{historyLabel(entry, counter.mode, liveValue)}</strong>
                          <span>{formatCounterDate(entry.occurredDate)} · {entry.createdBy}{entry.editedAt ? ` · edited by ${entry.editedBy}` : ""}</span>
                          {entry.note && <p>{entry.note}</p>}
                        </div>
                        {!counter.isArchived && (
                          <div className={styles.historyActions}>
                            <button type="button" onClick={() => setEditingId(entry.id)} disabled={Boolean(busy)}>Edit</button>
                            {entry.kind !== "baseline" && !(counter.mode === "automatic" && detail.entries.length === 1 && !detail.nextCursor) && (
                              <button type="button" className={styles.deleteEntry} onClick={() => removeEntry(entry)} disabled={Boolean(busy)}>Delete</button>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </li>
                ))}
              </ol>
            )}
            {detail?.nextCursor && <button type="button" className={styles.loadMore} onClick={() => loadDetail(detail.nextCursor, true)} disabled={loading}>Load more</button>}
          </section>

          <div className="ui-moduleActionRow">
            <ModuleEditButton onEdit={onEdit} disabled={Boolean(busy)} />
            <button type="button" className="ui-pillButton ui-pillSecondary ui-moduleActionButton" disabled={Boolean(busy)} onClick={() => mutate(counter.isArchived ? "restore" : "archive", () => counter.isArchived ? restoreCounter(counter.id, user.id) : archiveCounter(counter.id, user.id))}>{counter.isArchived ? "Restore" : "Archive"}</button>
            {counter.createdById === user.id && <button type="button" className="ui-pillButton ui-pillDanger ui-moduleActionButton" disabled={Boolean(busy)} onClick={removeCounter}>{busy === "delete-counter" ? "Deleting…" : "Delete"}</button>}
          </div>
        </ExpandableCardRegion>
      </article>
      {confirmationDialog}
    </div>
  );
}
