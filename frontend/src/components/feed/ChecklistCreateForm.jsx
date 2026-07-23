import { useState } from "react";
import { useAuth } from "../../context/AuthContext.jsx";
import { createChecklist } from "../../api/checklists.js";
import { cx } from "../../utils/classNames.js";
import styles from "./ChecklistCreateForm.module.css";

export default function ChecklistCreateForm({
  onChecklistsChange,
  onSuccess,
  onCancel,
}) {
  const { user } = useAuth();
  const [title, setTitle] = useState("");
  const [items, setItems] = useState([""]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const cleanedItems = items.map((item) => item.trim()).filter(Boolean);

  function updateItem(index, value) {
    setItems((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? value : item)),
    );
  }

  function removeItem(index) {
    setItems((current) =>
      current.length === 1
        ? [""]
        : current.filter((_, itemIndex) => itemIndex !== index),
    );
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle || cleanedItems.length === 0 || sending) return;
    setSending(true);
    setError("");
    try {
      const updated = await createChecklist(
        trimmedTitle,
        user.id,
        cleanedItems,
      );
      onChecklistsChange(updated);
      onSuccess?.();
    } catch (err) {
      setError(err.message || "Could not create the checklist. Try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <div className={styles.fields}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Checklist title</span>
          <input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={280}
            placeholder="Costco Run"
            className={cx("ui-textInput", styles.input)}
          />
        </label>

        <div className={styles.field}>
          <span className={styles.fieldLabel}>Items</span>
          <div className={styles.items}>
            {items.map((item, index) => (
              <div key={index} className={styles.itemRow}>
                <input
                  type="text"
                  value={item}
                  onChange={(event) => updateItem(index, event.target.value)}
                  maxLength={280}
                  placeholder="Add an item"
                  className={cx("ui-textInput", styles.input)}
                />
                <button
                  type="button"
                  onClick={() => removeItem(index)}
                  disabled={sending}
                  className={styles.removeItem}
                  aria-label="Remove checklist item"
                  title="Remove"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setItems((current) => [...current, ""])}
            disabled={sending}
            className={cx("ui-pillButton ui-pillSecondary", styles.addItem)}
          >
            Add item
          </button>
        </div>
      </div>

      {error ? (
        <p className={cx("ui-errorText", styles.error)}>{error}</p>
      ) : null}

      <div className="ui-formActions">
        <button
          type="button"
          onClick={onCancel}
          disabled={sending}
          className="ui-secondaryButton ui-formActionButton"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={sending || !title.trim() || cleanedItems.length === 0}
          className="ui-primaryButton ui-formActionButton"
        >
          {sending ? "Posting…" : "Post"}
        </button>
      </div>
    </form>
  );
}
