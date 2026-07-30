import { useCallback, useState } from "react";
import {
  addPollOption,
  archivePoll,
  commentOnPoll,
  deletePoll,
  editPollOption,
  restorePoll,
  setPollCommentLiked,
  setPollVote,
} from "../../api/polls.js";
import FeedComments from "../comments/FeedComments.jsx";
import Avatar from "../ui/Avatar.jsx";
import PeoplePopover from "../ui/PeoplePopover.jsx";
import { useConfirmDialog } from "../ui/useConfirmDialog.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { useExpandOnModuleFocus } from "../../context/ModuleFocusContext.jsx";
import { avatarColor } from "../../utils/avatar.js";
import { cx } from "../../utils/classNames.js";
import { relativeTime } from "../../utils/time.js";
import ModuleEditButton from "./ModuleEditButton.jsx";
import styles from "./PollFeature.module.css";

function OptionEditor({ value, onChange, onSubmit, onCancel, busy }) {
  return (
    <form onSubmit={onSubmit} className={styles.optionEditor}>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={280}
        autoFocus
        className={cx("ui-textInput", styles.optionEditorInput)}
      />
      <button
        type="submit"
        disabled={busy || !value.trim()}
        className={cx("ui-pillButton ui-pillCheckSoft", styles.iconAction)}
        aria-label="Save poll option"
        title="Save"
      >
        ✓
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={onCancel}
        className={cx("ui-pillButton ui-pillDangerSoft", styles.iconAction)}
        aria-label="Cancel editing poll option"
        title="Cancel"
      >
        ×
      </button>
    </form>
  );
}

export default function PollFeature({
  polls,
  roommates,
  onPollsChange,
  moduleTag,
  onEdit,
}) {
  const { user } = useAuth();
  const [expandedId, setExpandedId] = useState(null);
  const [newOption, setNewOption] = useState("");
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [openVotersOptionId, setOpenVotersOptionId] = useState(null);
  const [commentText, setCommentText] = useState("");
  const [likingCommentIds, setLikingCommentIds] = useState([]);
  const [openLikesCommentId, setOpenLikesCommentId] = useState(null);
  const { confirm, confirmationDialog } = useConfirmDialog();

  const closeTransientUi = useCallback(() => {
    setEditing(null);
    setOpenVotersOptionId(null);
    setOpenLikesCommentId(null);
  }, []);
  useExpandOnModuleFocus(setExpandedId);

  async function mutate(key, operation) {
    if (busy) return false;
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

  async function handleDelete(poll) {
    const confirmed = await confirm({
      title: `Delete ${poll.title}?`,
      message: "This permanently removes the poll, its votes, and comments.",
      confirmLabel: "Delete poll",
    });
    if (confirmed) await mutate("delete", () => deletePoll(poll.id, user.id));
  }

  function toggleExpanded(id) {
    setExpandedId((current) => (current === id ? null : id));
    closeTransientUi();
  }

  async function handleComment(event, poll) {
    event.preventDefault();
    const text = commentText.trim();
    if (!text) return;
    const saved = await mutate(`comment-${poll.id}`, () =>
      commentOnPoll(poll.id, user.id, text),
    );
    if (saved) setCommentText("");
  }

  async function handleCommentLike(poll, comment) {
    if (likingCommentIds.includes(comment.id)) return;
    setLikingCommentIds((current) => [...current, comment.id]);
    setError("");
    try {
      const liked = (comment.likedByIds ?? []).includes(user.id);
      await onPollsChange(
        await setPollCommentLiked(
          poll.id,
          comment.id,
          user.id,
          !liked,
        ),
      );
    } catch (requestError) {
      setError(requestError.message || "Could not update the comment like.");
    } finally {
      setLikingCommentIds((current) =>
        current.filter((id) => id !== comment.id),
      );
    }
  }

  return (
    <div className={styles.wrap}>
      {error && <p className="ui-errorText">{error}</p>}
      {polls.map((poll) => {
        const expanded = expandedId === poll.id;
        const creator = poll.createdById === user.id;
        return (
          <article
            className={cx(styles.card, poll.isArchived && styles.archived)}
            key={poll.id}
          >
            <button
              type="button"
              className={styles.summary}
              aria-expanded={expanded}
              onClick={() => toggleExpanded(poll.id)}
            >
              <span className={styles.summaryText}>
                <span className={styles.titleRow}>
                  {moduleTag}
                  <strong>{poll.title}</strong>
                </span>
                <span className={styles.meta}>
                  {poll.createdBy} · {relativeTime(poll.createdAt)}
                </span>
              </span>
            </button>

            <div
              className={cx(
                styles.expandedRegion,
                expanded ? styles.expanded : styles.collapsed,
              )}
            >
              <div
                className={styles.expandedInner}
                {...(!expanded ? { inert: "" } : {})}
              >
                <div className={styles.panel}>
                  {poll.options.length === 0 ? (
                    <p className={styles.empty}>
                      No options yet. Add the first one.
                    </p>
                  ) : (
                    <ul className={styles.options}>
                      {poll.options.map((option) => {
                        const selected = option.voterIds.includes(user.id);
                        const isEditing = editing?.id === option.id;
                        const voters = option.voters.map((person, index) => ({
                          ...person,
                          color: avatarColor(index),
                        }));
                        return (
                          <li
                            className={cx(
                              styles.option,
                              selected && styles.optionSelected,
                            )}
                            key={option.id}
                          >
                            {isEditing ? (
                              <OptionEditor
                                value={editing.text}
                                onChange={(text) =>
                                  setEditing({ ...editing, text })
                                }
                                onSubmit={async (event) => {
                                  event.preventDefault();
                                  const text = editing.text.trim();
                                  if (!text) return;
                                  const saved = await mutate(
                                    `edit-${option.id}`,
                                    () =>
                                      editPollOption(
                                        poll.id,
                                        option.id,
                                        user.id,
                                        text,
                                      ),
                                  );
                                  if (saved) setEditing(null);
                                }}
                                onCancel={() => setEditing(null)}
                                busy={busy === `edit-${option.id}`}
                              />
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className={cx(
                                    styles.voteButton,
                                    selected && styles.voteButtonSelected,
                                  )}
                                  disabled={poll.isArchived || Boolean(busy)}
                                  onClick={() =>
                                    mutate(`vote-${option.id}`, () =>
                                      setPollVote(
                                        poll.id,
                                        option.id,
                                        user.id,
                                        !selected,
                                      ),
                                    )
                                  }
                                  aria-pressed={selected}
                                  aria-label={
                                    selected
                                      ? `Remove vote from ${option.text}`
                                      : `Vote for ${option.text}`
                                  }
                                >
                                  ✓
                                </button>
                                {creator && !poll.isArchived ? (
                                  <button
                                    type="button"
                                    className={styles.optionText}
                                    onClick={() =>
                                      setEditing({
                                        id: option.id,
                                        text: option.text,
                                      })
                                    }
                                  >
                                    {option.text}
                                  </button>
                                ) : (
                                  <span className={styles.optionText}>
                                    {option.text}
                                  </span>
                                )}
                                <PeoplePopover
                                  people={voters}
                                  open={openVotersOptionId === option.id}
                                  onOpenChange={(open) =>
                                    setOpenVotersOptionId(
                                      open ? option.id : null,
                                    )
                                  }
                                  heading="Voted by"
                                  dialogLabel={`People who voted for ${option.text}`}
                                  buttonLabel={`View ${voters.length} ${
                                    voters.length === 1 ? "person" : "people"
                                  } who voted for ${option.text}`}
                                  disabled={voters.length === 0}
                                  triggerClassName={styles.voterTrigger}
                                >
                                  <span className={styles.voteCount}>
                                    {voters.length}
                                  </span>
                                  <span className={styles.voterAvatars}>
                                    {voters.map((person) => (
                                      <Avatar
                                        key={person.id}
                                        name={person.name}
                                        color={person.color}
                                        size={24}
                                      />
                                    ))}
                                  </span>
                                </PeoplePopover>
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
                      onSubmit={async (event) => {
                        event.preventDefault();
                        const text = newOption.trim();
                        if (!text) return;
                        const saved = await mutate("add", () =>
                          addPollOption(poll.id, user.id, text),
                        );
                        if (saved) setNewOption("");
                      }}
                    >
                      <input
                        className="ui-textInput"
                        maxLength={280}
                        value={newOption}
                        onChange={(event) => setNewOption(event.target.value)}
                        placeholder="Add an option"
                      />
                      <button
                        type="submit"
                        className="ui-pillButton ui-pillSecondary"
                        disabled={!newOption.trim() || Boolean(busy)}
                      >
                        Add
                      </button>
                    </form>
                  )}

                  <FeedComments
                    comments={poll.comments ?? []}
                    commentText={commentText}
                    onCommentTextChange={setCommentText}
                    onSubmitComment={(event) => handleComment(event, poll)}
                    roommates={roommates}
                    user={user}
                    commenting={busy === `comment-${poll.id}`}
                    likingCommentIds={likingCommentIds}
                    onToggleLike={(comment) =>
                      handleCommentLike(poll, comment)
                    }
                    openLikesCommentId={openLikesCommentId}
                    onOpenLikesChange={setOpenLikesCommentId}
                    open={expanded}
                    readOnly={poll.isArchived}
                  />

                  <div className="ui-moduleActionRow">
                    <ModuleEditButton
                      onEdit={onEdit}
                      disabled={Boolean(busy)}
                    />
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
                    <button
                      type="button"
                      className="ui-pillButton ui-pillDanger ui-moduleActionButton"
                      disabled={Boolean(busy)}
                      onClick={() => handleDelete(poll)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </article>
        );
      })}
      {confirmationDialog}
    </div>
  );
}
