import { useState } from "react";
import {
  archiveForum,
  commentOnForum,
  deleteForum,
  restoreForum,
  setForumCommentLiked,
} from "../../api/forums.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { useExpandOnModuleFocus } from "../../context/ModuleFocusContext.jsx";
import { cx } from "../../utils/classNames.js";
import { relativeTime } from "../../utils/time.js";
import FeedComments from "../comments/FeedComments.jsx";
import { useConfirmDialog } from "../ui/useConfirmDialog.jsx";
import ExpandableCardRegion from "./ExpandableCardRegion.jsx";
import BookLinkedModuleHeader from "./BookLinkedModuleHeader.jsx";
import ModuleEditButton from "./ModuleEditButton.jsx";
import styles from "./ForumFeature.module.css";

export default function ForumFeature({ forum, roommates, onForumsChange, moduleTag, onEdit }) {
  const { user } = useAuth();
  const [expandedId, setExpandedId] = useState(null);
  const [commentText, setCommentText] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [likingCommentIds, setLikingCommentIds] = useState([]);
  const [openLikesCommentId, setOpenLikesCommentId] = useState(null);
  const { confirm, confirmationDialog } = useConfirmDialog();
  useExpandOnModuleFocus(setExpandedId);

  async function mutate(key, operation) {
    if (busy) return false;
    setBusy(key);
    setError("");
    try {
      await onForumsChange(await operation());
      return true;
    } catch (requestError) {
      setError(requestError.message || "Could not update the forum.");
      return false;
    } finally {
      setBusy("");
    }
  }

  function toggleExpanded() {
    setExpandedId((current) => (current === forum.id ? null : forum.id));
    setCommentText("");
    setOpenLikesCommentId(null);
  }

  async function handleComment(event) {
    event.preventDefault();
    const text = commentText.trim();
    if (!text) return;
    const saved = await mutate("comment", () => commentOnForum(forum.id, user.id, text));
    if (saved) setCommentText("");
  }

  async function handleLike(comment) {
    if (likingCommentIds.includes(comment.id)) return;
    setLikingCommentIds((current) => [...current, comment.id]);
    setError("");
    try {
      const liked = (comment.likedByIds ?? []).includes(user.id);
      await onForumsChange(
        await setForumCommentLiked(forum.id, comment.id, user.id, !liked),
      );
    } catch (requestError) {
      setError(requestError.message || "Could not update the comment like.");
    } finally {
      setLikingCommentIds((current) => current.filter((id) => id !== comment.id));
    }
  }

  async function handleDelete() {
    const confirmed = await confirm({
      title: `Delete ${forum.title}?`,
      message: "This permanently removes the forum and its comments.",
      confirmLabel: "Delete forum",
    });
    if (confirmed) await mutate("delete", () => deleteForum(forum.id, user.id));
  }

  const expanded = expandedId === forum.id;
  return (
    <div className={styles.wrap}>
      {error ? <p className={cx("ui-errorText", styles.error)}>{error}</p> : null}
      <article className={cx(styles.card, forum.isArchived && styles.archived)}>
        <BookLinkedModuleHeader
          className={styles.summary}
          expanded={expanded}
          onToggle={toggleExpanded}
          toggleLabel={`forum ${forum.title}`}
          moduleTag={moduleTag}
          title={forum.title}
          bookLinkPlacement="subtitle"
          meta={`${forum.createdBy} · ${relativeTime(forum.createdAt)}`}
          bookId={forum.bookId}
          bookTitle={forum.bookTitle}
        />

        <ExpandableCardRegion expanded={expanded} className={styles.panel}>
          <FeedComments
            comments={forum.comments ?? []}
            commentText={commentText}
            onCommentTextChange={setCommentText}
            onSubmitComment={handleComment}
            roommates={roommates}
            user={user}
            commenting={busy === "comment"}
            likingCommentIds={likingCommentIds}
            onToggleLike={handleLike}
            openLikesCommentId={openLikesCommentId}
            onOpenLikesChange={setOpenLikesCommentId}
            open={expanded}
            readOnly={forum.isArchived}
          />

          <div className="ui-moduleActionRow">
            <ModuleEditButton onEdit={onEdit} disabled={Boolean(busy)} />
            <button
              type="button"
              className="ui-pillButton ui-pillSecondary ui-moduleActionButton"
              disabled={Boolean(busy)}
              onClick={() =>
                mutate(forum.isArchived ? "restore" : "archive", () =>
                  forum.isArchived
                    ? restoreForum(forum.id, user.id)
                    : archiveForum(forum.id, user.id),
                )
              }
            >
              {busy === "restore"
                ? "Restoring…"
                : busy === "archive"
                  ? "Archiving…"
                  : forum.isArchived
                    ? "Restore"
                    : "Archive"}
            </button>
            <button
              type="button"
              className="ui-pillButton ui-pillDanger ui-moduleActionButton"
              disabled={Boolean(busy)}
              onClick={handleDelete}
            >
              {busy === "delete" ? "Deleting…" : "Delete"}
            </button>
          </div>
        </ExpandableCardRegion>
      </article>
      {confirmationDialog}
    </div>
  );
}
