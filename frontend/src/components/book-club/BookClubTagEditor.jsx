import { useId, useState } from "react";
import {
  BOOK_TAG_LENGTH,
  BOOK_TAG_LIMIT,
  normalizeBookTag,
} from "../../utils/bookTags.js";
import styles from "./BookClubMeetingForm.module.css";

export default function BookClubTagEditor({ tags, availableTags, onChange, disabled }) {
  const suggestionsId = useId();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const selectedKeys = new Set(tags.map((tag) => tag.toLocaleLowerCase()));
  const suggestions = availableTags.filter(
    (tag) => !selectedKeys.has(tag.toLocaleLowerCase()),
  );

  function addTag() {
    const normalized = normalizeBookTag(draft);
    if (!normalized) return;
    // Reuse household spelling/casing when a member selects an existing label.
    const reusable = availableTags.find(
      (tag) => tag.toLocaleLowerCase() === normalized.toLocaleLowerCase(),
    );
    const label = reusable ?? normalized;
    if (selectedKeys.has(label.toLocaleLowerCase())) {
      setError(`${label} is already added.`);
      return;
    }
    if (tags.length >= BOOK_TAG_LIMIT) {
      setError(`Books can have at most ${BOOK_TAG_LIMIT} tags.`);
      return;
    }
    onChange([...tags, label]);
    setDraft("");
    setError("");
  }

  return (
    <fieldset className={styles.tagField} disabled={disabled}>
      <legend>Tags</legend>
      {tags.length ? (
        <div className={styles.tagList} aria-label="Selected book tags">
          {tags.map((tag) => (
            <span className={styles.tagChip} key={tag.toLocaleLowerCase()}>
              {tag}
              <button
                type="button"
                aria-label={`Remove ${tag} tag`}
                onClick={() => onChange(tags.filter((value) => value !== tag))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className={styles.tagControls}>
        <input
          type="text"
          aria-label="Book tag"
          list={suggestionsId}
          maxLength={BOOK_TAG_LENGTH}
          value={draft}
          placeholder="Genre, theme, or reading test"
          onChange={(event) => {
            setDraft(event.target.value);
            setError("");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              addTag();
            }
          }}
        />
        <datalist id={suggestionsId}>
          {suggestions.map((tag) => <option value={tag} key={tag} />)}
        </datalist>
        <button
          type="button"
          className="ui-secondaryButton"
          disabled={!normalizeBookTag(draft) || tags.length >= BOOK_TAG_LIMIT}
          onClick={addTag}
        >
          Add tag
        </button>
      </div>
      <small>{tags.length}/{BOOK_TAG_LIMIT} tags · press Enter or comma to add</small>
      {error ? <p className={styles.tagError}>{error}</p> : null}
    </fieldset>
  );
}
