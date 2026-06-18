// API client for the Roomie Status app.
//
// Every backend interaction goes through the functions in this file, so the
// rest of the app never talks to the network directly. Requests hit the Flask
// server's REST endpoints under /api (proxied in dev via vite.config.js to the
// VITE_API_TARGET, default http://localhost:8000).

const API_BASE = '/api'

// Thin wrapper around fetch that throws on non-2xx and parses JSON.
// Error responses carry a JSON `{ error }` body (see the Flask backend), which
// we surface as the thrown Error's message for display in the UI.
async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })

  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const message = data?.error || `Request failed: ${res.status}`
    throw new Error(message)
  }
  return data
}

// POST /api/login — exchange a name + password for the signed-in roommate.
export async function login(name, password) {
  return request('/login', {
    method: 'POST',
    body: JSON.stringify({ name, password }),
  })
}

// GET /api/roommates — the whole household with their current statuses.
export async function getRoommates() {
  return request('/roommates')
}

// PUT /api/roommates/:id/status — update one roommate's status.
// Returns the full, updated household so the UI can recompute the banner.
export async function updateStatus(id, status, statusText) {
  return request(`/roommates/${id}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status, statusText }),
  })
}

// GET /api/push/public-key — the VAPID public key needed to subscribe.
export async function getVapidPublicKey() {
  return request('/push/public-key')
}

// POST /api/push/subscribe — register this device's PushSubscription so the
// backend can notify it. A PushSubscription serializes to { endpoint, keys }.
export async function savePushSubscription(subscription) {
  return request('/push/subscribe', {
    method: 'POST',
    body: JSON.stringify(subscription),
  })
}

// GET /api/activities — the most recent proposed activities, newest first.
export async function getActivities() {
  return request('/activities')
}

// POST /api/activities — propose an activity (also pushes it to everyone).
// Returns the refreshed recent list.
export async function proposeActivity(text, proposedById) {
  return request('/activities', {
    method: 'POST',
    body: JSON.stringify({ text, proposedById }),
  })
}

// DELETE /api/activities/:id — permanently remove an activity owned by the
// requesting roommate. Returns the refreshed recent list.
export async function deleteActivity(id, requesterId) {
  return request(`/activities/${id}`, {
    method: 'DELETE',
    body: JSON.stringify({ requesterId }),
  })
}

// POST /api/activities/:id/notify — re-push an existing activity to everyone as
// "<emphasizedBy> emphasized <activity>". Anyone can emphasize any activity.
export async function notifyActivity(id, emphasizedBy) {
  return request(`/activities/${id}/notify`, {
    method: 'POST',
    body: JSON.stringify({ emphasizedBy }),
  })
}

// POST /api/activities/:id/join — add the named roommate to an activity.
// Returns the refreshed recent list (with updated member counts).
export async function joinActivity(id, name) {
  return request(`/activities/${id}/join`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

// POST /api/activities/:id/leave — remove the named roommate from an activity.
// Returns the refreshed recent list.
export async function leaveActivity(id, name) {
  return request(`/activities/${id}/leave`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

// POST /api/activities/:id/comments — add a comment to an activity.
// Returns the refreshed recent list (each activity carries its latest comments).
export async function commentOnActivity(id, author, text) {
  return request(`/activities/${id}/comments`, {
    method: 'POST',
    body: JSON.stringify({ author, text }),
  })
}
