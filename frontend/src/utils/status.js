// Status model shared across the app. Statuses are four fixed availability
// states (available, busy, sleeping, ooh). Each roommate can attach an optional
// free-form note (roommate.statusText) to give more detail about their current
// status — e.g. "back by 9pm" alongside "Busy with something".

export const STATUS = {
  AVAILABLE: 'available',
  BUSY: 'busy',
  SLEEPING: 'sleeping',
  OOH: 'ooh',
}

// Display order for the status options. The editor renders one panel per entry
// here so the list lives in a single place.
export const STATUS_ORDER = [STATUS.AVAILABLE, STATUS.BUSY, STATUS.SLEEPING, STATUS.OOH]

// Human-readable label for each status.
export const STATUS_LABEL = {
  [STATUS.AVAILABLE]: 'Available to hang',
  [STATUS.BUSY]: 'Busy with something',
  [STATUS.SLEEPING]: 'Sleeping',
  [STATUS.OOH]: 'OOH (Out Of House)',
}

// Number of available roommates that triggers the "gather!" banner + push
// (PROJECT.md: "3 or more"). Keep in sync with the backend
// (AVAILABLE_THRESHOLD env, default 3).
export const AVAILABLE_THRESHOLD = 3

// The label shown for a roommate's current status.
export function statusLabel(roommate) {
  return STATUS_LABEL[roommate.status] ?? 'Unknown'
}

// The optional supplemental note a roommate added for their current status,
// or '' when they left it blank.
export function statusNote(roommate) {
  return roommate.statusText?.trim() || ''
}

// Count how many roommates are currently available to hang.
export function availableCount(roommates) {
  return roommates.filter((r) => r.status === STATUS.AVAILABLE).length
}
