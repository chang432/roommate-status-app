import { useState } from "react";
import { useAuth } from "../../context/AuthContext.jsx";
import { createShow } from "../../api/shows.js";
import { cx } from "../../utils/classNames.js";
import styles from "./ShowCreateForm.module.css";

// Popup body for adding a new show: a single title field. The creator is
// auto-joined as the first watcher by the backend.
export default function ShowCreateForm({ onShowsChange, onSuccess, onCancel }) {
  const { user } = useAuth();
  const [title, setTitle] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle || sending) return;
    setSending(true);
    setError("");
    try {
      onShowsChange(await createShow(trimmedTitle, user.id, user.name));
      onSuccess?.();
    } catch (err) {
      setError(err.message || "Could not add the show. Try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Show title</span>
        <input
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={280}
          placeholder="Severance"
          autoFocus
          className={cx("ui-textInput", styles.input)}
        />
      </label>

      {error ? (
        <p className={cx("ui-errorText", styles.error)}>{error}</p>
      ) : null}

      <div className={styles.actions}>
        <button
          type="button"
          onClick={onCancel}
          disabled={sending}
          className={cx("ui-secondaryButton", styles.actionButton)}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={sending || !title.trim()}
          className={cx("ui-primaryButton", styles.actionButton)}
        >
          {sending ? "Adding…" : "Add show"}
        </button>
      </div>
    </form>
  );
}
