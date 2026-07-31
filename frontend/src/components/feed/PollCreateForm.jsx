import { useState } from "react";
import { createPoll } from "../../api/polls.js";
import { useAuth } from "../../context/AuthContext.jsx";
import RepeatableTextFields from "../ui/RepeatableTextFields.jsx";
import { cx } from "../../utils/classNames.js";
import styles from "./PollCreateForm.module.css";

export default function PollCreateForm({ onPollsChange, onSuccess, onCancel }) {
  const { user } = useAuth();
  const [title, setTitle] = useState("");
  const [options, setOptions] = useState([""]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const cleanedOptions = options.map((option) => option.trim()).filter(Boolean);

  async function submit(event) {
    event.preventDefault();
    if (!title.trim() || sending) return;
    setSending(true);
    setError("");
    try {
      onPollsChange(await createPoll(title.trim(), user.id, cleanedOptions));
      onSuccess?.();
    } catch (requestError) {
      setError(requestError.message || "Could not create the poll.");
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={submit} className={styles.form}>
      <div className={styles.fields}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Poll title</span>
          <input
            type="text"
            className={cx("ui-textInput", styles.input)}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={280}
            placeholder="What should we do?"
            disabled={sending}
          />
        </label>
        <RepeatableTextFields
          label="Options (optional)"
          itemLabel="Poll option"
          values={options}
          onChange={setOptions}
          addLabel="Add option"
          placeholder="Add an option"
          disabled={sending}
          maxItems={50}
        />
      </div>

      {error ? (
        <p className={cx("ui-errorText", styles.error)}>{error}</p>
      ) : null}

      <div className="ui-formActions">
        <button
          type="button"
          className="ui-secondaryButton ui-formActionButton"
          onClick={onCancel}
          disabled={sending}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="ui-primaryButton ui-formActionButton"
          disabled={!title.trim() || sending}
        >
          {sending ? "Posting…" : "Post poll"}
        </button>
      </div>
    </form>
  );
}
