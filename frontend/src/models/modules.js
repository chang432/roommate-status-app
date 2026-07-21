export const MODULE_DEFINITIONS = {
  events: {
    id: 'events',
    label: 'Events',
    shortLabel: 'Events',
    ownerField: 'proposedById',
    edit: {
      label: 'Edit event',
      field: 'text',
      fieldLabel: 'Event',
      schedule: true,
    },
  },
  requests: {
    id: 'requests',
    label: 'Requests',
    shortLabel: 'Requests',
    ownerField: 'requesterId',
    edit: {
      label: 'Edit request',
      field: 'text',
      fieldLabel: 'Request',
      recipients: true,
    },
  },
  checklists: {
    id: 'checklists',
    label: 'Checklists',
    shortLabel: 'Lists',
    ownerField: 'createdById',
    edit: {
      label: 'Edit checklist',
      field: 'title',
      fieldLabel: 'Checklist title',
    },
  },
  tv: {
    id: 'tv',
    label: 'TV',
    shortLabel: 'TV',
    ownerField: 'createdById',
    edit: { label: 'Edit show', field: 'title', fieldLabel: 'Show title' },
  },
  spotify: {
    id: 'spotify',
    label: 'Spotify',
    shortLabel: 'Spotify',
    ownerField: 'hostId',
    edit: {
      label: 'Edit Spotify Jam',
      field: 'link',
      fieldLabel: 'Spotify Jam link',
      inputType: 'url',
    },
  },
}

export const MODULE_TYPES = [
  { id: 'all', label: 'All', shortLabel: 'All' },
  ...Object.values(MODULE_DEFINITIONS)
    .filter(({ id }) => id !== 'spotify')
    .map(({ id, label, shortLabel }) => ({
    id,
    label,
    shortLabel,
  })),
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
    this.isArchived = Boolean(feedItem.isArchived)
    this.payload = feedItem.payload || {}
  }

  get typeLabel() {
    return MODULE_TYPES.find((type) => type.id === this.type)?.shortLabel ?? this.type
  }

  get ownerId() {
    const ownerField = MODULE_DEFINITIONS[this.type]?.ownerField
    return ownerField ? this.payload[ownerField] : null
  }

  isEditableBy(userId) {
    return !this.isArchived && this.ownerId === userId
  }
}

MODULE_CLASS_BY_TYPE.events = EventModule

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
