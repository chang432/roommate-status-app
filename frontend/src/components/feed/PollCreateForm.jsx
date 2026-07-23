import { useState } from "react";
import { createPoll } from "../../api/polls.js";
import { useAuth } from "../../context/AuthContext.jsx";
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
      <label className={styles.field}>
        <span>Poll title</span>
        <input
          className="ui-textInput"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={280}
          placeholder="What should we do?"
        />
      </label>
      <div className={styles.field}>
        <span>Options (optional)</span>
        {options.map((option, index) => (
          <div className={styles.optionRow} key={index}>
            <input
              className="ui-textInput"
              value={option}
              onChange={(event) =>
                setOptions((current) =>
                  current.map((value, optionIndex) =>
                    optionIndex === index ? event.target.value : value,
                  ),
                )
              }
              maxLength={280}
              placeholder="Add an option"
            />
            <button
              type="button"
              className="ui-pillButton ui-pillDangerSoft"
              onClick={() =>
                setOptions((current) =>
                  current.length === 1
                    ? [""]
                    : current.filter((_, optionIndex) => optionIndex !== index),
                )
              }
              aria-label="Remove option"
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          className={cx("ui-pillButton ui-pillSecondary", styles.add)}
          onClick={() => setOptions((current) => [...current, ""])}
          disabled={options.length >= 50}
        >
          Add option
        </button>
      </div>
      {error && <p className="ui-errorText">{error}</p>}
      <div className="ui-formActions">
        <button type="button" className="ui-secondaryButton ui-formActionButton" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="ui-primaryButton ui-formActionButton" disabled={!title.trim() || sending}>
          {sending ? "Posting…" : "Post poll"}
        </button>
      </div>
    </form>
  );
}
