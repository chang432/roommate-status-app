// Theme-owned avatar colors rotate by roommate index for stable visual identity.
const AVATAR_COLORS = [
  'hsl(var(--color-avatar-1))',
  'hsl(var(--color-avatar-2))',
  'hsl(var(--color-avatar-3))',
  'hsl(var(--color-avatar-4))',
  'hsl(var(--color-avatar-5))',
  'hsl(var(--color-avatar-6))',
]

export function avatarColor(index) {
  return AVATAR_COLORS[index % AVATAR_COLORS.length]
}

export function initialOf(name) {
  return name?.trim()?.charAt(0)?.toUpperCase() ?? '?'
}
