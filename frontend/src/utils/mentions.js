function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Return the @query immediately before the caret. Mentions only trigger at the
// start of text or after a non-word boundary, so email-like text does not open
// the household picker.
export function activeMention(text, caret) {
  const beforeCaret = text.slice(0, caret)
  const match = beforeCaret.match(/(^|[^\w@])@([A-Za-z0-9_-]*)$/)
  if (!match) return null
  return {
    start: beforeCaret.length - match[2].length - 1,
    query: match[2],
  }
}

export function mentionMatches(text, mentions) {
  const names = mentions
    .map((mention) => mention.name)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
  if (names.length === 0) return []

  const pattern = new RegExp(
    `(^|[^\\w@])(@(?:${names.map(escapeRegExp).join('|')}))(?=$|[^\\w])`,
    'gi',
  )
  const matches = []
  for (const match of text.matchAll(pattern)) {
    const start = match.index + match[1].length
    matches.push({ start, end: start + match[2].length })
  }
  return matches
}
