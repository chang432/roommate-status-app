// Warm avatar background colors, rotated by roommate index for variety.
// Mirrors the .av-1 … .av-6 palette from the original mockups.
const AVATAR_COLORS = [
  '#c97b5a',
  '#8a9a7b',
  '#d6a35c',
  '#9d7b9c',
  '#6f9a9a',
  '#c4736f',
]

export function avatarColor(index) {
  return AVATAR_COLORS[index % AVATAR_COLORS.length]
}

export function initialOf(name) {
  return name?.trim()?.charAt(0)?.toUpperCase() ?? '?'
}
