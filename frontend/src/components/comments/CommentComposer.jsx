import { useId, useMemo, useRef, useState } from 'react'
import { activeMention } from '../../utils/mentions.js'
import { cx } from '../../utils/classNames.js'
import styles from './CommentComposer.module.css'

export default function CommentComposer({
  value,
  onChange,
  onSubmit,
  roommates,
  currentUserId,
  busy,
}) {
  const inputRef = useRef(null)
  const suggestionListId = useId()
  const [mention, setMention] = useState(null)
  const [selectedIndex, setSelectedIndex] = useState(0)

  const suggestions = useMemo(() => {
    if (!mention) return []
    const query = mention.query.toLowerCase()
    const everyone = {
      id: '__all__',
      name: 'all',
      description: 'Everyone',
    }
    const roommateSuggestions = roommates
      .filter((roommate) => roommate.id !== currentUserId)
      .filter((roommate) => roommate.name.toLowerCase().includes(query))
      .sort((a, b) => a.name.localeCompare(b.name))
    return 'all'.includes(query) ? [everyone, ...roommateSuggestions] : roommateSuggestions
  }, [currentUserId, mention, roommates])

  function syncMention(nextValue, caret) {
    setMention(activeMention(nextValue, caret))
    setSelectedIndex(0)
  }

  function handleChange(event) {
    onChange(event.target.value)
    syncMention(event.target.value, event.target.selectionStart)
  }

  function selectSuggestion(roommate) {
    if (!mention) return
    const caret = inputRef.current?.selectionStart ?? value.length
    const nextValue =
      value.slice(0, mention.start) + `@${roommate.name} ` + value.slice(caret)
    if (nextValue.length > 280) return

    const nextCaret = mention.start + roommate.name.length + 2
    onChange(nextValue)
    setMention(null)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(nextCaret, nextCaret)
    })
  }

  function handleKeyDown(event) {
    if (!mention || suggestions.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelectedIndex((index) => (index + 1) % suggestions.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelectedIndex((index) => (index - 1 + suggestions.length) % suggestions.length)
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      selectSuggestion(suggestions[selectedIndex])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setMention(null)
    }
  }

  return (
    <form onSubmit={onSubmit} className={styles.form}>
      <div className={styles.inputWrap}>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={handleChange}
          onClick={(event) => syncMention(value, event.currentTarget.selectionStart)}
          onKeyDown={handleKeyDown}
          onBlur={() => setMention(null)}
          maxLength={280}
          placeholder="Add a comment… Use @ to mention someone"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={Boolean(mention && suggestions.length)}
          aria-controls={suggestionListId}
          className={cx('ui-textInput', styles.input)}
        />
        {mention && suggestions.length > 0 && (
          <ul
            id={suggestionListId}
            role="listbox"
            className={styles.suggestions}
          >
            {suggestions.map((roommate, index) => (
              <li key={roommate.id} role="option" aria-selected={index === selectedIndex}>
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault()
                    selectSuggestion(roommate)
                  }}
                  className={cx(
                    styles.suggestion,
                    index === selectedIndex
                      ? styles.suggestionActive
                      : styles.suggestionIdle,
                  )}
                >
                  @{roommate.name}
                  {roommate.description && (
                    <span className="ml-2 font-normal text-ink-soft">
                      — {roommate.description}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button
        type="submit"
        disabled={busy || !value.trim()}
        aria-label="Send comment"
        className={cx('ui-primaryButton', styles.sendButton)}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
      </button>
    </form>
  )
}
