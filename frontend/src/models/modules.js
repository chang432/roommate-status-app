export const MODULE_TYPES = [
  { id: 'all', label: 'All modules', shortLabel: 'All' },
  { id: 'events', label: 'Events', shortLabel: 'Events' },
  { id: 'requests', label: 'Requests', shortLabel: 'Requests' },
  { id: 'checklists', label: 'Checklists', shortLabel: 'Lists' },
  { id: 'tv', label: 'TV', shortLabel: 'TV' },
  { id: 'spotify', label: 'Spotify', shortLabel: 'Spotify' },
]

// One warm, distinct color per module type (mirrors the avatarColor palette
// approach). `soft` tints tag/panel backgrounds; `text` is the readable label
// tone; `solid` is the saturated accent for borders/emphasis.
export const MODULE_COLORS = {
  events: { solid: '#c97b5a', soft: '#f5e1d6', text: '#8a4a30' },
  requests: { solid: '#6f8fb0', soft: '#dfe8f2', text: '#3f5a76' },
  checklists: { solid: '#d6a35c', soft: '#f3e6cf', text: '#8a6420' },
  tv: { solid: '#9d7b9c', soft: '#ece1ec', text: '#5f3f5e' },
  spotify: { solid: '#5aa06f', soft: '#dcefe0', text: '#356b45' },
}

// Inline style for a module's color-coded feed tag: a soft tint with a readable
// deep-tone label, keyed by module type.
export function moduleTagStyle(type) {
  const color = MODULE_COLORS[type]
  if (!color) return undefined
  return { backgroundColor: color.soft, color: color.text, borderColor: color.soft }
}

// Inline style for a color-coded create panel: same tint, but with the solid
// accent as the border so each module option reads as its own color.
export function modulePanelStyle(type) {
  const color = MODULE_COLORS[type]
  if (!color) return undefined
  return { backgroundColor: color.soft, color: color.text, borderColor: color.solid }
}

const MODULE_CLASS_BY_TYPE = {}

export class BaseModule {
  constructor(feedItem) {
    this.id = feedItem.id
    this.type = feedItem.type
    this.createdAt = Number(feedItem.createdAt)
    this.updatedAt = Number(feedItem.updatedAt ?? feedItem.createdAt)
    this.sortAt = Number(feedItem.sortAt ?? this.updatedAt ?? this.createdAt)
    this.title = feedItem.title || 'Module'
    this.subtitle = feedItem.subtitle || ''
    this.actor = feedItem.actor || 'Someone'
    this.isArchived = Boolean(feedItem.isArchived)
    this.payload = feedItem.payload || {}
  }

  get typeLabel() {
    return MODULE_TYPES.find((type) => type.id === this.type)?.shortLabel ?? this.type
  }
}

export class EventModule extends BaseModule {
  get typeLabel() {
    return this.payload.isLive ? 'Live event' : 'Event'
  }
}
export class RequestModule extends BaseModule {}
export class ChecklistModule extends BaseModule {}
export class TvModule extends BaseModule {}

export class SpotifyModule extends BaseModule {}

MODULE_CLASS_BY_TYPE.events = EventModule
MODULE_CLASS_BY_TYPE.requests = RequestModule
MODULE_CLASS_BY_TYPE.checklists = ChecklistModule
MODULE_CLASS_BY_TYPE.tv = TvModule
MODULE_CLASS_BY_TYPE.spotify = SpotifyModule

export function createModule(feedItem) {
  const ModuleClass = MODULE_CLASS_BY_TYPE[feedItem.type] ?? BaseModule
  return new ModuleClass(feedItem)
}

export function createModules(feedItems) {
  return feedItems
    .map(createModule)
    // Most recently edited first (top), least recent last (bottom). `sortAt`
    // tracks the last material update, so a freshly-edited module rises to the
    // top of the feed.
    .sort((a, b) => b.sortAt - a.sortAt || b.createdAt - a.createdAt)
}
