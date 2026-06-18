import { useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import {
  proposeActivity,
  deleteActivity,
  notifyActivity,
  joinActivity,
  leaveActivity,
  commentOnActivity,
} from '../api/client.js'
import CommentComposer from './CommentComposer.jsx'
import MentionText from './MentionText.jsx'
import { relativeTime } from '../utils/time.js'

// "Propose an activity": a text field + Send button that pushes the proposal to
// everyone, with the most recent proposals listed below (newest nearest the
// input).
export default function ProposeActivity({
  activities,
  onActivitiesChange,
  liveEvent,
  transitioningId,
  onLiveTransition,
  roommates,
}) {
  const { user } = useAuth()
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  // Per-activity notify state: the id currently sending, and the id just sent
  // (briefly shown as a confirmation).
  const [notifyingId, setNotifyingId] = useState(null)
  const [sentId, setSentId] = useState(null)
  // The id of the activity whose member panel is expanded, and the id whose
  // join/leave request is currently in flight (to disable its button).
  const [expandedId, setExpandedId] = useState(null)
  const [joiningId, setJoiningId] = useState(null)
  // The comment draft for the currently expanded activity, and the id whose
  // comment is currently being posted (only one panel is open at a time, so a
  // single draft string is enough — it's cleared whenever the panel changes).
  const [commentText, setCommentText] = useState('')
  const [commentingId, setCommentingId] = useState(null)
  // Deletion is owner-only and uses a two-step inline confirmation.
  const [confirmingDeleteId, setConfirmingDeleteId] = useState(null)
  const [deletingId, setDeletingId] = useState(null)

  // Open/close an activity's panel, clearing any half-typed comment so a draft
  // never bleeds from one activity's panel into another's.
  function toggleExpanded(id) {
    setExpandedId((cur) => (cur === id ? null : id))
    setCommentText('')
    setConfirmingDeleteId(null)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const trimmed = text.trim()
    if (!trimmed || sending) return
    setSending(true)
    setError('')
    try {
      const updated = await proposeActivity(trimmed, user.id)
      onActivitiesChange(updated)
      setText('')
    } catch {
      setError('Could not send your proposal. Try again.')
    } finally {
      setSending(false)
    }
  }

  async function handleDelete(activity) {
    if (deletingId) return
    setDeletingId(activity.id)
    setError('')
    try {
      const updated = await deleteActivity(activity.id, user.id)
      onActivitiesChange(updated)
      setConfirmingDeleteId(null)
      setExpandedId((current) => (current === activity.id ? null : current))
    } catch {
      setError('Could not delete the activity. Try again.')
    } finally {
      setDeletingId(null)
    }
  }

  // Notify the other participants that you emphasized this activity.
  async function handleNotify(activity) {
    if (notifyingId) return
    setNotifyingId(activity.id)
    setError('')
    try {
      await notifyActivity(activity.id, user.id)
      setSentId(activity.id)
      setTimeout(() => setSentId((cur) => (cur === activity.id ? null : cur)), 2000)
    } catch {
      setError('Could not send the notification. Try again.')
    } finally {
      setNotifyingId(null)
    }
  }

  // Toggle the current user's membership of an activity. The member list comes
  // back from the server, so the count and panel stay in sync everywhere.
  async function handleToggleMember(activity, isMember) {
    if (joiningId) return
    setJoiningId(activity.id)
    setError('')
    try {
      const updated = isMember
        ? await leaveActivity(activity.id, user.id)
        : await joinActivity(activity.id, user.id)
      onActivitiesChange(updated)
    } catch {
      setError(`Could not ${isMember ? 'leave' : 'join'} the activity. Try again.`)
    } finally {
      setJoiningId(null)
    }
  }

  // Post the current draft as a comment on `activity`. The server returns the
  // refreshed feed (with the new comment), so counts and lists stay in sync.
  async function handleComment(e, activity) {
    e.preventDefault()
    const trimmed = commentText.trim()
    if (!trimmed || commentingId) return
    setCommentingId(activity.id)
    setError('')
    try {
      const updated = await commentOnActivity(activity.id, user.id, trimmed)
      onActivitiesChange(updated)
      setCommentText('')
    } catch {
      setError('Could not post your comment. Try again.')
    } finally {
      setCommentingId(null)
    }
  }

  return (
    <section className="mt-[34px]">
      <p className="mb-3 ml-[2px] text-[12.5px] font-bold uppercase tracking-[0.05em] text-ink-soft">
        Propose an activity
      </p>

      <form onSubmit={handleSubmit} className="flex gap-[10px]">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={280}
          placeholder="Pizza and a movie?"
          className="flex-1 rounded-sm border border-line bg-white px-[14px] py-[12px] text-[14px] text-ink outline-none transition placeholder:text-[#b6a995] focus:border-accent"
        />
        <button
          type="submit"
          disabled={sending || !text.trim()}
          className="flex-none rounded-sm bg-accent px-[20px] py-[12px] text-[14px] font-bold text-white transition hover:bg-accent-deep disabled:opacity-60"
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
      </form>

      {error && (
        <p className="mt-2 text-[13px] font-semibold text-status-red">{error}</p>
      )}

      <div className="mt-[14px] space-y-[10px]">
        {activities.length === 0 ? (
          <p className="text-[13.5px] text-ink-soft">
            No activities yet — propose the first one!
          </p>
        ) : (
          activities.map((a) => {
            const members = a.members ?? []
            const isMember = (a.memberIds ?? []).includes(user.id)
            // The proposer is permanently part of their own activity, so they
            // get no Join/Leave button.
            const canDelete = a.proposedById === user.id
            const expanded = expandedId === a.id
            return (
              <div
                key={a.id}
                // The whole card is a toggle that expands the member panel; the
                // action buttons inside stop propagation so they don't toggle it.
                role="button"
                tabIndex={0}
                aria-expanded={expanded}
                onClick={() => toggleExpanded(a.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    toggleExpanded(a.id)
                  }
                }}
                className="cursor-pointer rounded-sm border border-line bg-card px-[14px] py-[10px] transition hover:border-accent-soft"
              >
                <div className="flex items-center gap-[10px]">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-[7px]">
                      <p className="text-[14px] text-ink">{a.text}</p>
                      {a.isLive && (
                        <span className="rounded-full bg-status-red px-[8px] py-[3px] text-[10px] font-bold uppercase tracking-[0.08em] text-white">
                          Live
                        </span>
                      )}
                    </div>
                    <p className="mt-[2px] text-[12px] text-ink-soft">
                      {a.proposedBy} · {relativeTime(a.createdAt)}
                    </p>
                  </div>
                  {/* Member count — at least 1 since the proposer auto-joins. */}
                  <span
                    className="flex-none text-[13px] font-bold text-ink-soft"
                    title={`${members.length} joined`}
                  >
                    👥 {members.length}
                  </span>
                  {canDelete && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onLiveTransition(a, a.isLive ? 'end' : 'start')
                      }}
                      disabled={
                        Boolean(transitioningId) || (!a.isLive && Boolean(liveEvent))
                      }
                      title={
                        !a.isLive && liveEvent
                          ? `${liveEvent.text} is already live`
                          : undefined
                      }
                      className={`flex-none rounded-full border px-[13px] py-[8px] text-[12px] font-bold transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50 ${
                        a.isLive
                          ? 'border-status-red bg-status-red text-white'
                          : 'border-accent bg-accent text-white'
                      }`}
                    >
                      {transitioningId === a.id
                        ? a.isLive
                          ? 'Ending…'
                          : 'Starting…'
                        : a.isLive
                          ? 'End'
                          : 'Start'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleNotify(a)
                    }}
                    disabled={notifyingId === a.id}
                    // Icon-only: text is dropped in favor of the bell; aria-label
                    // keeps it accessible, and a ✓ briefly confirms a sent notify.
                    aria-label="Notify participants"
                    className="flex-none rounded-full border border-[#d6e2c5] bg-[#eef3e7] px-[12px] py-[8px] text-[14px] font-bold text-[#50603f] transition hover:brightness-95 disabled:opacity-60"
                  >
                    {sentId === a.id ? '✓' : '🔔'}
                  </button>
                  {!canDelete && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleToggleMember(a, isMember)
                      }}
                      disabled={joiningId === a.id}
                      className={`flex-none rounded-full border px-[14px] py-[8px] text-[12.5px] font-bold transition hover:brightness-95 disabled:opacity-60 ${
                        isMember
                          ? 'border-line bg-white text-ink-soft'
                          : 'border-accent bg-accent text-white'
                      }`}
                    >
                      {isMember ? 'Leave' : 'Join'}
                    </button>
                  )}
                </div>

                {/* Expandable panel. Kept mounted (not conditionally rendered)
                    so its height can animate via the grid 0fr→1fr trick, which
                    slides smoothly to the content's natural height with no magic
                    max-height. `inert` while collapsed keeps the hidden controls
                    out of the tab order and unclickable. */}
                <div
                  className={`grid transition-[grid-template-rows] duration-700 ease-out motion-reduce:transition-none ${
                    expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                  }`}
                >
                  <div
                    className="min-h-0 overflow-hidden"
                    {...(!expanded ? { inert: '' } : {})}
                  >
                    <div className="mt-[12px] border-t border-line pt-[12px]">
                      <p className="mb-[8px] text-[12px] font-bold uppercase tracking-[0.05em] text-ink-soft">
                        Who’s in
                      </p>
                      {members.length === 0 ? (
                        <p className="text-[13px] text-ink-soft">No one yet.</p>
                      ) : (
                        <div className="flex flex-wrap gap-[8px]">
                          {members.map((name) => (
                            <span
                              key={name}
                              className="rounded-md bg-accent-soft px-[12px] py-[8px] text-[13px] font-semibold text-ink"
                            >
                              {name}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Comments — the activity's most recent messages (oldest
                          first, newest nearest the input) plus a box to add one.
                          Clicks/keys are kept inside so typing or focusing the
                          input doesn't toggle the surrounding card. */}
                      <div
                        className="mt-[14px] border-t border-line pt-[12px]"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        <p className="mb-[8px] text-[12px] font-bold uppercase tracking-[0.05em] text-ink-soft">
                          Comments
                        </p>
                        {(a.comments ?? []).length === 0 ? (
                          <p className="mb-[10px] text-[13px] text-ink-soft">
                            No comments yet.
                          </p>
                        ) : (
                          <ul className="mb-[10px] space-y-[8px]">
                            {a.comments.map((c, i) => (
                              <li key={`${c.createdAt}-${i}`} className="text-[13px]">
                                <span className="font-bold text-ink">{c.author}</span>{' '}
                                <span className="text-[11px] text-ink-soft">
                                  {relativeTime(c.createdAt)}
                                </span>
                                <p className="text-ink">
                                  <MentionText
                                    text={c.text}
                                    mentions={c.mentions}
                                    mentionsAll={c.mentionsAll}
                                  />
                                </p>
                              </li>
                            ))}
                          </ul>
                        )}
                        <CommentComposer
                          value={commentText}
                          onChange={setCommentText}
                          onSubmit={(event) => handleComment(event, a)}
                          roommates={roommates}
                          currentUserId={user.id}
                          busy={commentingId === a.id}
                        />
                      </div>

                      {canDelete && (
                        <div
                          className="mt-[14px] flex flex-wrap items-center justify-end gap-[8px] border-t border-line pt-[12px]"
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          {confirmingDeleteId === a.id ? (
                            <>
                              <span className="mr-auto text-[12.5px] font-semibold text-status-red max-[400px]:w-full">
                                Delete this event?
                              </span>
                              <button
                                type="button"
                                onClick={() => setConfirmingDeleteId(null)}
                                disabled={deletingId === a.id}
                                className="rounded-full border border-line bg-white px-[13px] py-[7px] text-[12.5px] font-bold text-ink-soft transition hover:bg-[#faf6ef] disabled:opacity-60"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDelete(a)}
                                disabled={deletingId === a.id || a.isLive}
                                title={
                                  a.isLive ? 'End the event before deleting it' : undefined
                                }
                                className="rounded-full border border-status-red bg-status-red px-[13px] py-[7px] text-[12.5px] font-bold text-white transition hover:brightness-95 disabled:opacity-60"
                              >
                                {deletingId === a.id ? 'Deleting…' : 'Delete'}
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmingDeleteId(a.id)}
                              disabled={a.isLive}
                              title={a.isLive ? 'End the event before deleting it' : undefined}
                              className="rounded-full border border-[#e8c5bf] bg-[#fbeae6] px-[13px] py-[7px] text-[12.5px] font-bold text-status-red transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Delete event
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </section>
  )
}
