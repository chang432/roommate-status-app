import { useLayoutEffect, useRef } from 'react'
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
  open,
  readOnly = false,
}) {
  const commentScrollerRef = useRef(null)

  useLayoutEffect(() => {
    if (!open || !commentScrollerRef.current) return
    // The panel stays mounted while collapsed, so reset its internal position
    // only when the card opens instead of on every feed refresh.
    commentScrollerRef.current.scrollTop = commentScrollerRef.current.scrollHeight
  }, [open])

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
        <div ref={commentScrollerRef} className={styles.commentScroller}>
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
                    busy={readOnly || likingCommentIds.includes(comment.id)}
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
      {!readOnly && (
        <CommentComposer
          value={commentText}
          onChange={onCommentTextChange}
          onSubmit={onSubmitComment}
          roommates={roommates}
          currentUserId={user.id}
          busy={commenting}
        />
      )}
    </div>
  )
}
