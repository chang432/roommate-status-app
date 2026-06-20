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

// POST /api/roommates/notify — remind every other roommate to update status.
export async function notifyRoommatesToUpdateStatus(requesterId) {
  return request('/roommates/notify', {
    method: 'POST',
    body: JSON.stringify({ requesterId }),
  })
}

// POST /api/roommates/:id/poke — send one roommate directly to their status
// editor when they select the resulting push notification.
export async function pokeRoommate(id, requesterId) {
  return request(`/roommates/${id}/poke`, {
    method: 'POST',
    body: JSON.stringify({ requesterId }),
  })
}

// GET /api/push/public-key — the VAPID public key needed to subscribe.
export async function getVapidPublicKey() {
  return request('/push/public-key')
}

// POST /api/push/subscribe — associate this device's PushSubscription with the
// signed-in roommate so the backend can target and exclude recipients.
export async function savePushSubscription(subscription, userId) {
  return request('/push/subscribe', {
    method: 'POST',
    body: JSON.stringify({ subscription, userId }),
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

// POST /api/activities/:id/start|end — creator-owned live transitions.
// Each returns the refreshed feed so the card and homepage banner stay in sync.
export async function startActivity(id, requesterId) {
  return request(`/activities/${id}/start`, {
    method: 'POST',
    body: JSON.stringify({ requesterId }),
  })
}

export async function endActivity(id, requesterId) {
  return request(`/activities/${id}/end`, {
    method: 'POST',
    body: JSON.stringify({ requesterId }),
  })
}

// POST /api/activities/:id/join — add the identified roommate to an activity.
// Returns the refreshed recent list (with updated member counts).
export async function joinActivity(id, userId) {
  return request(`/activities/${id}/join`, {
    method: 'POST',
    body: JSON.stringify({ userId }),
  })
}

// POST /api/activities/:id/leave — remove the identified roommate from an activity.
// Returns the refreshed recent list.
export async function leaveActivity(id, userId) {
  return request(`/activities/${id}/leave`, {
    method: 'POST',
    body: JSON.stringify({ userId }),
  })
}

// POST /api/activities/:id/comments — add a comment to an activity.
// Returns the refreshed recent list (each activity carries its latest comments).
export async function commentOnActivity(id, authorId, text) {
  return request(`/activities/${id}/comments`, {
    method: 'POST',
    body: JSON.stringify({ authorId, text }),
  })
}

// PUT/DELETE /api/activities/:id/comments/:commentId/likes — idempotently
// update the signed-in roommate's reaction and return the refreshed feed.
export async function setCommentLiked(id, commentId, userId, liked) {
  return request(`/activities/${id}/comments/${commentId}/likes`, {
    method: liked ? 'PUT' : 'DELETE',
    body: JSON.stringify({ userId }),
  })
}
