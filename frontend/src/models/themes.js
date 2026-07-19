export const THEME_DEFINITIONS = [
  { id: 'system', label: 'System', description: 'Match this device' },
  { id: 'light', label: 'Light', description: 'Warm daylight' },
  { id: 'dark', label: 'Dark', description: 'Low-light room' },
  { id: 'forest', label: 'Forest', description: 'Dark evergreen' },
]

export const THEME_IDS = THEME_DEFINITIONS.map(({ id }) => id)

export function isThemeId(value) {
  return THEME_IDS.includes(value)
}

export function themeDefinition(id) {
  return THEME_DEFINITIONS.find((theme) => theme.id === id)
}
