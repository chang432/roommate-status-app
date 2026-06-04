// Status model shared across the app. The three statuses come from PROJECT.md:
// available, busy, and a free-form custom message.

export const STATUS = {
  AVAILABLE: 'available',
  BUSY: 'busy',
  CUSTOM: 'custom',
}

// Default human-readable label for the fixed statuses. Custom statuses carry
// their own text, so they have no default label here.
export const STATUS_LABEL = {
  [STATUS.AVAILABLE]: 'Available to hang',
  [STATUS.BUSY]: 'Busy with something',
}

// Tailwind dot color per status (see tailwind.config.js palette).
export const STATUS_DOT_CLASS = {
  [STATUS.AVAILABLE]: 'bg-status-green',
  [STATUS.BUSY]: 'bg-status-red',
  [STATUS.CUSTOM]: 'bg-status-purple',
}

// Number of available roommates that triggers the "gather!" notification.
export const AVAILABLE_THRESHOLD = 3

// Resolve the text shown for a roommate: custom messages use their stored text,
// fixed statuses fall back to the default label.
export function statusText(roommate) {
  if (roommate.status === STATUS.CUSTOM) {
    return roommate.statusText?.trim() || 'Custom message'
  }
  return STATUS_LABEL[roommate.status] ?? 'Unknown'
}

// Count how many roommates are currently available to hang.
export function availableCount(roommates) {
  return roommates.filter((r) => r.status === STATUS.AVAILABLE).length
}
