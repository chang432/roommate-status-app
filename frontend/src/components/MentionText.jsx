import { Fragment } from 'react'
import { mentionMatches } from '../utils/mentions.js'
import styles from './styling/MentionText.module.css'

export default function MentionText({ text, mentions = [], mentionsAll = false }) {
  const matches = mentionMatches(text, mentions, mentionsAll)
  if (matches.length === 0) return text

  const parts = []
  let cursor = 0
  matches.forEach((match, index) => {
    parts.push(
      <Fragment key={`text-${index}`}>{text.slice(cursor, match.start)}</Fragment>,
    )
    parts.push(
      <span key={`mention-${index}`} className={styles.mention}>
        {text.slice(match.start, match.end)}
      </span>,
    )
    cursor = match.end
  })
  parts.push(<Fragment key="text-end">{text.slice(cursor)}</Fragment>)
  return parts
}
