// API client for the Roomie Status app.
//
// Every backend interaction goes through the functions in this file, so wiring
// up a real server later means editing only this module. Each function targets
// a placeholder REST endpoint under /api (see the Vite proxy in vite.config.js).
//
// Because there is no backend yet, requests transparently fall back to an
// in-memory mock (see mock.js) when the real endpoint is unreachable. Flip
// USE_MOCK to false once a server is live to require the real API.

import {
  mockLogin,
  mockGetRoommates,
  mockUpdateStatus,
} from './mock.js'

const API_BASE = '/api'

// While there's no backend, default to the mock. Set VITE_USE_MOCK=false (and
// run a server behind the proxy) to talk to the real API instead.
const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false'

// Thin wrapper around fetch that throws on non-2xx and parses JSON.
async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const message = await res.text().catch(() => res.statusText)
    throw new Error(message || `Request failed: ${res.status}`)
  }
  return res.json()
}

// POST /api/login — exchange a name + password for the signed-in roommate.
export async function login(name, password) {
  if (USE_MOCK) return mockLogin(name, password)
  return request('/login', {
    method: 'POST',
    body: JSON.stringify({ name, password }),
  })
}

// GET /api/roommates — the whole household with their current statuses.
export async function getRoommates() {
  if (USE_MOCK) return mockGetRoommates()
  return request('/roommates')
}

// PUT /api/roommates/:id/status — update one roommate's status.
// Returns the full, updated household so the UI can recompute the banner.
export async function updateStatus(id, status, statusText) {
  if (USE_MOCK) return mockUpdateStatus(id, status, statusText)
  return request(`/roommates/${id}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status, statusText }),
  })
}
