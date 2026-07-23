import { useState } from "react";
import {
  addPollOption,
  archivePoll,
  deletePoll,
  editPollOption,
  restorePoll,
  setPollVote,
} from "../../api/polls.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { useExpandOnModuleFocus } from "../../context/ModuleFocusContext.jsx";
import { cx } from "../../utils/classNames.js";
import { relativeTime } from "../../utils/time.js";
import ModuleEditButton from "./ModuleEditButton.jsx";
import styles from "./PollFeature.module.css";

export default function PollFeature({ polls, onPollsChange, moduleTag, onEdit }) {
  const { user } = useAuth();
  const [expandedId, setExpandedId] = useState(null);
  const [newOption, setNewOption] = useState("");
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  useExpandOnModuleFocus(setExpandedId);

  async function mutate(key, operation) {
    if (busy) return;
    setBusy(key);
    setError("");
    try {
      await onPollsChange(await operation());
      return true;
    } catch (requestError) {
      setError(requestError.message || "Could not update the poll.");
      return false;
    } finally {
      setBusy("");
    }
  }

  return (
    <div className={styles.wrap}>
      {error && <p className="ui-errorText">{error}</p>}
      {polls.map((poll) => {
        const expanded = expandedId === poll.id;
        const creator = poll.createdById === user.id;
        return (
          <article className={cx(styles.card, poll.isArchived && styles.archived)} key={poll.id}>
            <button
              type="button"
              className={styles.summary}
              aria-expanded={expanded}
              onClick={() => setExpandedId(expanded ? null : poll.id)}
            >
              <span className={styles.summaryText}>
                <span className={styles.titleRow}>{moduleTag}<strong>{poll.title}</strong></span>
                <span className={styles.meta}>{poll.createdBy} · {relativeTime(poll.createdAt)}</span>
              </span>
              <span aria-hidden="true">{expanded ? "−" : "+"}</span>
            </button>
            {expanded && (
              <div className={styles.panel}>
                {poll.options.length === 0 ? (
                  <p className={styles.empty}>No options yet. Add the first one.</p>
                ) : (
                  <ul className={styles.options}>
                    {poll.options.map((option) => {
                      const selected = option.voterIds.includes(user.id);
                      const isEditing = editing?.id === option.id;
                      return (
                        <li className={styles.option} key={option.id}>
                          {isEditing ? (
                            <form
                              className={styles.optionEdit}
                              onSubmit={(event) => {
                                event.preventDefault();
                                const text = editing.text.trim();
                                if (!text) return;
                                mutate(`edit-${option.id}`, () =>
                                  editPollOption(poll.id, option.id, user.id, text),
                                ).then((saved) => {
                                  if (saved) setEditing(null);
                                });
                              }}
                            >
                              <input className="ui-textInput" maxLength={280} value={editing.text} onChange={(event) => setEditing({ ...editing, text: event.target.value })} />
                              <button className="ui-pillButton ui-pillSecondary" type="submit">Save</button>
                              <button className="ui-pillButton ui-pillSecondary" type="button" onClick={() => setEditing(null)}>Cancel</button>
                            </form>
                          ) : (
                            <>
                              <button
                                type="button"
                                className={cx(styles.vote, selected && styles.voted)}
                                disabled={poll.isArchived || Boolean(busy)}
                                onClick={() =>
                                  mutate(`vote-${option.id}`, () =>
                                    setPollVote(poll.id, option.id, user.id, !selected),
                                  )
                                }
                                aria-pressed={selected}
                              >
                                <span>{option.text}</span>
                                <strong>{option.voterIds.length}</strong>
                              </button>
                              <p className={styles.voters}>
                                {option.voters.length
                                  ? option.voters.map((voter) => voter.name).join(", ")
                                  : "No votes yet"}
                              </p>
                              {creator && !poll.isArchived && (
                                <button type="button" className={styles.editOption} onClick={() => setEditing({ id: option.id, text: option.text })}>
                                  Edit option
                                </button>
                              )}
                            </>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {!poll.isArchived && (
                  <form
                    className={styles.addOption}
                    onSubmit={(event) => {
                      event.preventDefault();
                      const text = newOption.trim();
                      if (!text) return;
                      mutate("add", () => addPollOption(poll.id, user.id, text)).then((saved) => {
                        if (saved) setNewOption("");
                      });
                    }}
                  >
                    <input className="ui-textInput" maxLength={280} value={newOption} onChange={(event) => setNewOption(event.target.value)} placeholder="Add an option" />
                    <button type="submit" className="ui-pillButton ui-pillSecondary" disabled={!newOption.trim() || Boolean(busy)}>Add</button>
                  </form>
                )}
                <div className="ui-moduleActionRow">
                  <ModuleEditButton onEdit={onEdit} disabled={Boolean(busy)} />
                  <button
                    type="button"
                    className="ui-pillButton ui-pillSecondary ui-moduleActionButton"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      mutate(poll.isArchived ? "restore" : "archive", () =>
                        poll.isArchived
                          ? restorePoll(poll.id, user.id)
                          : archivePoll(poll.id, user.id),
                      )
                    }
                  >
                    {poll.isArchived ? "Restore" : "Archive"}
                  </button>
                  <button type="button" className="ui-pillButton ui-pillDanger ui-moduleActionButton" disabled={Boolean(busy)} onClick={() => mutate("delete", () => deletePoll(poll.id, user.id))}>
                    Delete
                  </button>
                </div>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
