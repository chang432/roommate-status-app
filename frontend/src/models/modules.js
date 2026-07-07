export const MODULE_TYPES = [
  { id: 'all', label: 'All modules', shortLabel: 'All' },
  { id: 'events', label: 'Events', shortLabel: 'Events' },
  { id: 'requests', label: 'Requests', shortLabel: 'Requests' },
  { id: 'checklists', label: 'Checklists', shortLabel: 'Lists' },
  { id: 'tv', label: 'TV', shortLabel: 'TV' },
  { id: 'spotify', label: 'Spotify', shortLabel: 'Spotify' },
]

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
    this.payload = feedItem.payload || {}
  }

  get typeLabel() {
    return MODULE_TYPES.find((type) => type.id === this.type)?.shortLabel ?? this.type
  }

  get isHidden() {
    return false
  }
}

export class EventModule extends BaseModule {
  get typeLabel() {
    return this.payload.isLive ? 'Live event' : 'Event'
  }

  get isHidden() {
    return Boolean(this.payload.isExpired)
  }
}

export class RequestModule extends BaseModule {
  get isHidden() {
    return Boolean(this.payload.isCompleted)
  }
}

export class ChecklistModule extends BaseModule {
  get isHidden() {
    return Boolean(this.payload.isArchived)
  }
}

export class TvModule extends BaseModule {
  get isHidden() {
    return Boolean(this.payload.completed)
  }
}

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
    .filter((module) => !module.isHidden)
    // Most recently edited first (top), least recent last (bottom). `sortAt`
    // tracks the last material update, so a freshly-edited module rises to the
    // top of the feed.
    .sort((a, b) => b.sortAt - a.sortAt || b.createdAt - a.createdAt)
}
