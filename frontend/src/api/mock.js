// In-memory mock backend.
//
// Stands in for a real server/database so the UI is fully functional during
// development. State lives in module scope and is seeded into localStorage so
// status changes survive page reloads within a browser session.
//
// This file is the only place that fabricates data — client.js calls into it
// when USE_MOCK is on. Delete it (and the USE_MOCK branch) once a backend exists.

import { STATUS } from '../utils/status.js'

const STORAGE_KEY = 'roomie-status-mock-v1'

// The household. In a real app this lives in the database; passwords would be
// hashed server-side. Here every roommate shares a demo password.
const DEMO_PASSWORD = 'roomie'

const SEED_ROOMMATES = [
  { id: 'andre', name: 'Andre', status: STATUS.AVAILABLE, statusText: '' },
  { id: 'jordan', name: 'Jordan', status: STATUS.AVAILABLE, statusText: '' },
  { id: 'maya', name: 'Maya', status: STATUS.CUSTOM, statusText: 'At the gym till 7' },
  { id: 'sam', name: 'Sam', status: STATUS.BUSY, statusText: '' },
  { id: 'priya', name: 'Priya', status: STATUS.AVAILABLE, statusText: '' },
  { id: 'leo', name: 'Leo', status: STATUS.BUSY, statusText: '' },
]

// Load persisted roommate state, falling back to the seed on first run.
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    // Ignore corrupt/unavailable storage and reseed.
  }
  return structuredClone(SEED_ROOMMATES)
}

function persist(roommates) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(roommates))
  } catch {
    // Storage may be unavailable (private mode); state still works in-memory.
  }
}

let roommates = load()

// Simulate network latency so loading states are exercised.
function delay(value, ms = 350) {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

export async function mockLogin(name, password) {
  const match = roommates.find(
    (r) => r.name.toLowerCase() === String(name).trim().toLowerCase(),
  )
  if (!match || password !== DEMO_PASSWORD) {
    // Mimic an API rejection for bad credentials.
    await delay(null, 250)
    throw new Error('That name and password don’t match. (Demo password: roomie)')
  }
  return delay({ user: { id: match.id, name: match.name } })
}

export async function mockGetRoommates() {
  return delay(structuredClone(roommates))
}

export async function mockUpdateStatus(id, status, statusText) {
  roommates = roommates.map((r) =>
    r.id === id
      ? { ...r, status, statusText: status === STATUS.CUSTOM ? statusText : '' }
      : r,
  )
  persist(roommates)
  return delay(structuredClone(roommates))
}
