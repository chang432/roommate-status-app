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

// GET /api/activities — current activities followed by expired history.
export async function getActivities() {
  return request('/activities')
}

// POST /api/activities — propose an activity (also pushes it to everyone).
// Returns the refreshed activity list.
export async function proposeActivity(text, proposedById, startAt = null, endAt = null) {
  return request('/activities', {
    method: 'POST',
    body: JSON.stringify({ text, proposedById, startAt, endAt }),
  })
}

// POST /api/activities/:id/archive — move an activity into expired history
// without deleting it. Returns the refreshed activity list.
export async function archiveActivity(id, requesterId) {
  return request(`/activities/${id}/archive`, {
    method: 'POST',
    body: JSON.stringify({ requesterId }),
  })
}

// DELETE /api/activities/:id — permanently remove an activity owned by the
// requesting roommate. Returns the refreshed activity list.
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

// PATCH /api/activities/:id/schedule — replace a pending owner's schedule.
export async function updateActivitySchedule(id, requesterId, startAt, endAt) {
  return request(`/activities/${id}/schedule`, {
    method: 'PATCH',
    body: JSON.stringify({ requesterId, startAt, endAt }),
  })
}

// POST /api/activities/:id/join — add the identified roommate to an activity.
// Returns the refreshed activity list (with updated member counts).
export async function joinActivity(id, userId) {
  return request(`/activities/${id}/join`, {
    method: 'POST',
    body: JSON.stringify({ userId }),
  })
}

// POST /api/activities/:id/leave — remove the identified roommate from an activity.
// Returns the refreshed activity list.
export async function leaveActivity(id, userId) {
  return request(`/activities/${id}/leave`, {
    method: 'POST',
    body: JSON.stringify({ userId }),
  })
}

// POST /api/activities/:id/comments — add a comment to an activity.
// Returns the refreshed activity list (each activity carries its latest comments).
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

// GET /api/requests — recent household requests, newest first.
export async function getRequests() {
  return request('/requests')
}

// POST /api/requests — create a targeted request for specific roommates.
// Returns the refreshed request list.
export async function createRequest(text, requesterId, requestedIds) {
  return request('/requests', {
    method: 'POST',
    body: JSON.stringify({ text, requesterId, requestedIds }),
  })
}

// POST /api/requests/:id/responses — accept or deny a request.
// `response` is "accepted" or "denied".
export async function respondToRequest(id, userId, response) {
  return request(`/requests/${id}/responses`, {
    method: 'POST',
    body: JSON.stringify({ userId, response }),
  })
}

// POST /api/requests/:id/complete — mark a request completed.
export async function completeRequest(id, userId) {
  return request(`/requests/${id}/complete`, {
    method: 'POST',
    body: JSON.stringify({ userId }),
  })
}

// POST /api/requests/:id/reopen — move a completed request back to active.
export async function reopenRequest(id, userId) {
  return request(`/requests/${id}/reopen`, {
    method: 'POST',
    body: JSON.stringify({ userId }),
  })
}

// DELETE /api/requests/:id — delete a request owned by the requester.
export async function deleteRequest(id, requesterId) {
  return request(`/requests/${id}`, {
    method: 'DELETE',
    body: JSON.stringify({ requesterId }),
  })
}

// POST /api/requests/:id/comments — add a comment to a request.
export async function commentOnRequest(id, authorId, text) {
  return request(`/requests/${id}/comments`, {
    method: 'POST',
    body: JSON.stringify({ authorId, text }),
  })
}

// PUT/DELETE /api/requests/:id/comments/:commentId/likes — update a request
// comment reaction and return the refreshed request list.
export async function setRequestCommentLiked(id, commentId, userId, liked) {
  return request(`/requests/${id}/comments/${commentId}/likes`, {
    method: liked ? 'PUT' : 'DELETE',
    body: JSON.stringify({ userId }),
  })
}
