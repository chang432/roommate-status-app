// Status model shared across the app. Statuses are four fixed availability
// states (available, busy, sleeping, ooh). Each roommate can attach an optional
// free-form note (roommate.statusText) to give more detail about their current
// status — e.g. "back by 9pm" alongside "Busy with smth".

export const STATUS = {
  AVAILABLE: 'available',
  BUSY: 'busy',
  SLEEPING: 'sleeping',
  OOH: 'ooh',
  ACTIVITY_LIVE: 'activity_live',
  ACTIVITY_ENDED: 'activity_ended',
}

// Display order for the status options. The editor renders one panel per entry
// here so the list lives in a single place.
export const STATUS_ORDER = [STATUS.AVAILABLE, STATUS.BUSY, STATUS.SLEEPING, STATUS.OOH]

// Human-readable label for each status.
export const STATUS_LABEL = {
  [STATUS.AVAILABLE]: 'Available to hang',
  [STATUS.BUSY]: 'Busy with smth',
  [STATUS.SLEEPING]: 'Sleeping',
  [STATUS.OOH]: 'OOH (Out Of House)',
  [STATUS.ACTIVITY_LIVE]: 'In an activity',
  [STATUS.ACTIVITY_ENDED]: 'Finished an activity',
}

// Number of available roommates that triggers the "gather!" banner + push
// (PROJECT.md: "3 or more"). Keep in sync with the backend
// (AVAILABLE_THRESHOLD env, default 3).
export const AVAILABLE_THRESHOLD = 3

export function isActivityStatus(status) {
  return status === STATUS.ACTIVITY_LIVE || status === STATUS.ACTIVITY_ENDED
}

function activityEndedAt(activity) {
  const endedAt = activity.endedAt ?? activity.endAt
  return typeof endedAt === 'number' ? endedAt : null
}

function upsertActivityStatus(current, next) {
  if (!current) return next
  if (next.status === STATUS.ACTIVITY_LIVE) {
    if (current.status !== STATUS.ACTIVITY_LIVE) return next
    return next.timestamp > current.timestamp ? next : current
  }
  if (current.status === STATUS.ACTIVITY_LIVE) return current
  return next.timestamp > current.timestamp ? next : current
}

function activityStatusByUser(activities) {
  const byUser = {}
  activities.forEach((activity) => {
    const memberIds = activity.memberIds ?? []
    if (activity.isLive) {
      const timestamp = activity.liveStartedAt ?? activity.startAt ?? 0
      memberIds.forEach((userId) => {
        byUser[userId] = upsertActivityStatus(byUser[userId], {
          status: STATUS.ACTIVITY_LIVE,
          timestamp,
          title: activity.text,
        })
      })
      return
    }

    const timestamp = activityEndedAt(activity)
    if (timestamp === null) return
    memberIds.forEach((userId) => {
      byUser[userId] = upsertActivityStatus(byUser[userId], {
        status: STATUS.ACTIVITY_ENDED,
        timestamp,
        title: activity.text,
      })
    })
  })
  return byUser
}

function activityStatusLabel(activityStatus) {
  return activityStatus.status === STATUS.ACTIVITY_LIVE
    ? `In ${activityStatus.title}`
    : `Finished ${activityStatus.title}`
}

export function decorateRoommatesWithActivityStatus(roommates, activities) {
  const overlays = activityStatusByUser(activities)
  return roommates.map((roommate) => {
    const baseStatus = roommate.status
    const baseStatusText = roommate.statusText || ''
    const overlay = overlays[roommate.id]
    if (!overlay) {
      return {
        ...roommate,
        baseStatus,
        baseStatusText,
        isActivityStatus: false,
      }
    }

    const updatedAt = roommate.statusUpdatedAt
    if (
      overlay.status === STATUS.ACTIVITY_ENDED &&
      updatedAt !== null &&
      updatedAt !== undefined &&
      updatedAt >= overlay.timestamp
    ) {
      return {
        ...roommate,
        baseStatus,
        baseStatusText,
        isActivityStatus: false,
      }
    }

    return {
      ...roommate,
      baseStatus,
      baseStatusText,
      status: overlay.status,
      statusText: '',
      statusUpdatedAt: overlay.timestamp,
      statusLabelOverride: activityStatusLabel(overlay),
      statusNoteOverride: '',
      isActivityStatus: true,
      activityStatusTitle: overlay.title,
    }
  })
}

// The label shown for a roommate's current status.
export function statusLabel(roommate) {
  if (roommate.statusLabelOverride) return roommate.statusLabelOverride
  return STATUS_LABEL[roommate.status] ?? 'Unknown'
}

// The optional supplemental note a roommate added for their current status,
// or '' when they left it blank.
export function statusNote(roommate) {
  if (roommate.statusNoteOverride !== undefined) return roommate.statusNoteOverride
  return roommate.statusText?.trim() || ''
}

// Count how many roommates are currently available to hang.
export function availableCount(roommates) {
  return roommates.filter((r) => r.status === STATUS.AVAILABLE).length
}
