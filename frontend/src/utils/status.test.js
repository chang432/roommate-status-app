import { describe, expect, it } from 'vitest'
import { decorateRoommatesWithActivityStatus, STATUS } from './status.js'

const roommates = [
  {
    id: 'andre',
    name: 'Andre',
    status: STATUS.AVAILABLE,
    statusText: '',
    statusUpdatedAt: null,
  },
]

describe('decorateRoommatesWithActivityStatus', () => {
  it('does not mark participants finished for an event that is still scheduled', () => {
    const [andre] = decorateRoommatesWithActivityStatus(roommates, [
      {
        text: 'Future dinner',
        memberIds: ['andre'],
        startAt: 1_001_000,
        endAt: 1_002_000,
        isLive: false,
        isExpired: false,
      },
    ])

    expect(andre.status).toBe(STATUS.AVAILABLE)
    expect(andre.isActivityStatus).toBe(false)
  })

  it('returns participants to their saved status after an event ends', () => {
    const [andre] = decorateRoommatesWithActivityStatus(roommates, [
      {
        text: 'Past dinner',
        memberIds: ['andre'],
        startAt: 1_001_000,
        endAt: 1_002_000,
        endedAt: 1_002_000,
        isLive: false,
        isExpired: true,
      },
    ])

    expect(andre.status).toBe(STATUS.AVAILABLE)
    expect(andre.isActivityStatus).toBe(false)
  })
})
