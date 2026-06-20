import CommentComposer from './CommentComposer.jsx'
import CommentLikeButton from './CommentLikeButton.jsx'
import MentionText from './MentionText.jsx'
import { relativeTime } from '../utils/time.js'
import styles from './styling/FeedComments.module.css'

export default function FeedComments({
  comments,
  commentText,
  onCommentTextChange,
  onSubmitComment,
  roommates,
  user,
  commenting,
  likingCommentIds,
  onToggleLike,
  openLikesCommentId,
  onOpenLikesChange,
}) {
  return (
    <div
      className={styles.comments}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <p className={styles.panelTitle}>Comments</p>
      {comments.length === 0 ? (
        <p className={styles.emptyComments}>No comments yet.</p>
      ) : (
        <div className={styles.commentScroller}>
          <ul className={styles.commentList}>
            {comments.map((comment, index) => (
              <li
                key={comment.id ?? `${comment.createdAt}-${index}`}
                className={styles.comment}
              >
                <div className={styles.commentMeta}>
                  <span className={styles.commentAuthor}>{comment.author}</span>
                  <span className={styles.commentTime}>
                    {relativeTime(comment.createdAt)}
                  </span>
                  <CommentLikeButton
                    count={comment.likeCount ?? 0}
                    liked={(comment.likedByIds ?? []).includes(user.id)}
                    ownComment={
                      comment.authorId === user.id ||
                      (!comment.authorId &&
                        comment.author.toLowerCase() === user.name.toLowerCase())
                    }
                    busy={likingCommentIds.includes(comment.id)}
                    onToggle={() => onToggleLike(comment)}
                    likedByIds={comment.likedByIds ?? []}
                    roommates={roommates}
                    open={openLikesCommentId === comment.id}
                    onOpenChange={(open) =>
                      onOpenLikesChange(open ? comment.id : null)
                    }
                  />
                </div>
                <p className={styles.commentText}>
                  <MentionText
                    text={comment.text}
                    mentions={comment.mentions}
                    mentionsAll={comment.mentionsAll}
                  />
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
      <CommentComposer
        value={commentText}
        onChange={onCommentTextChange}
        onSubmit={onSubmitComment}
        roommates={roommates}
        currentUserId={user.id}
        busy={commenting}
      />
    </div>
  )
}
