// API client for the Roomie Status app.
//
// Every backend interaction goes through the functions in this file, so the
// rest of the app never talks to the network directly. Requests hit the Flask
// server's REST endpoints under /api (proxied in dev via vite.config.js to the
// VITE_API_TARGET, default http://localhost:8000).

const API_BASE = '/api'

// Called when the backend reports the stored session's user no longer exists
// (error code "invalid_user") — e.g. the local in-memory DB was reseeded.
// AuthContext registers logout here so a dead session bounces to the login
// page instead of leaving every fetch failing.
let onInvalidUser = null

export function setInvalidUserHandler(handler) {
  onInvalidUser = handler
}

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
    if (data?.code === 'invalid_user') onInvalidUser?.()
    const message = data?.error || `Request failed: ${res.status}`
    throw new Error(message)
  }
  return data
}

// Append non-empty params to a path. Returns a path WITHOUT the /api prefix —
// request() adds API_BASE exactly once (returning it prefixed here used to
// double it into /api/api/..., 404ing every list fetch).
function withQuery(path, params) {
  const search = new URLSearchParams()
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, value)
    }
  })
  const query = search.toString()
  return query ? `${path}?${query}` : path
}

// POST /api/login — exchange a username + password for the signed-in account.
export async function login(username, password) {
  return request('/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
}

// POST /api/accounts — create a no-group account and sign in as it.
export async function createAccount(username, name, password) {
  return request('/accounts', {
    method: 'POST',
    body: JSON.stringify({ username, name, password }),
  })
}

// GET /api/accounts/:id — re-fetch an account to validate a stored session.
export async function getAccount(id) {
  return request(`/accounts/${id}`)
}

// DELETE /api/accounts/:id — delete the signed-in account after password check.
export async function deleteAccount(id, password) {
  return request(`/accounts/${id}`, {
    method: 'DELETE',
    body: JSON.stringify({ password }),
  })
}

// POST /api/groups/join — assign a pending account to a household by code.
export async function joinGroup(userId, code) {
  return request('/groups/join', {
    method: 'POST',
    body: JSON.stringify({ userId, code }),
  })
}

// GET /api/groups/current — fetch the signed-in user's group metadata.
export async function getCurrentGroup(userId) {
  return request(withQuery('/groups/current', { userId }))
}

// GET /api/roommates — the whole household with their current statuses.
export async function getRoommates(userId) {
  return request(withQuery('/roommates', { userId }))
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

// GET /api/jam — the one active household Spotify Jam, if any.
export async function getJam(userId) {
  return request(withQuery('/jam', { userId }))
}

// GET /api/feed — normalized active module instances in feed order.
export async function getFeed(userId, type = 'all') {
  return request(withQuery('/feed', { userId, type }))
}

// POST /api/jam — replace the active household Jam link.
export async function shareJam(link, hostId) {
  return request('/jam', {
    method: 'POST',
    body: JSON.stringify({ link, hostId }),
  })
}

// DELETE /api/jam — end the active Jam owned by the host.
export async function endJam(hostId) {
  return request('/jam', {
    method: 'DELETE',
    body: JSON.stringify({ hostId }),
  })
}

// GET /api/activities — current activities followed by expired history.
export async function getActivities(userId) {
  return request(withQuery('/activities', { userId }))
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
export async function getRequests(userId) {
  return request(withQuery('/requests', { userId }))
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

// GET /api/checklists — recent active household checklists.
export async function getChecklists(userId) {
  return request(withQuery('/checklists', { userId }))
}

// POST /api/checklists — create a checklist with an initial set of items.
export async function createChecklist(title, createdById, items) {
  return request('/checklists', {
    method: 'POST',
    body: JSON.stringify({ title, createdById, items }),
  })
}

// POST /api/checklists/:id/notify — remind everyone else about a checklist.
export async function notifyChecklist(id, requesterId) {
  return request(`/checklists/${id}/notify`, {
    method: 'POST',
    body: JSON.stringify({ requesterId }),
  })
}

// POST /api/checklists/:id/items — add one item to an active checklist.
export async function addChecklistItem(id, userId, text) {
  return request(`/checklists/${id}/items`, {
    method: 'POST',
    body: JSON.stringify({ userId, text }),
  })
}

// POST /api/checklists/:id/items/:itemId/toggle — toggle the signed-in user's
// checkmark on one checklist item.
export async function toggleChecklistItem(id, itemId, userId) {
  return request(`/checklists/${id}/items/${itemId}/toggle`, {
    method: 'POST',
    body: JSON.stringify({ userId }),
  })
}

// PATCH /api/checklists/:id/items/:itemId — edit one item.
export async function updateChecklistItem(id, itemId, userId, text) {
  return request(`/checklists/${id}/items/${itemId}`, {
    method: 'PATCH',
    body: JSON.stringify({ userId, text }),
  })
}

// DELETE /api/checklists/:id/items/:itemId — delete one item.
export async function deleteChecklistItem(id, itemId, userId) {
  return request(`/checklists/${id}/items/${itemId}`, {
    method: 'DELETE',
    body: JSON.stringify({ userId }),
  })
}

// POST /api/checklists/:id/archive — remove a checklist from the active feed.
export async function archiveChecklist(id, userId) {
  return request(`/checklists/${id}/archive`, {
    method: 'POST',
    body: JSON.stringify({ userId }),
  })
}

// --- TV show tracker -----------------------------------------------------
// Backed by the Flask server's /api/shows endpoints (docker/flask/
// household_shows.py), which persist to a dedicated DynamoDB table. Every
// mutation returns the full, refreshed show list so the UI can recompute in one
// pass. The display name on join/create is resolved server-side from the
// roommate's account; it is sent here only so callers keep a stable signature.

// GET /api/shows — the caller's group's shows with watchers and season/episode.
export async function getShows(userId) {
  return request(withQuery('/shows', { userId }))
}

// POST /api/shows — create a show; the creator is auto-added as a watcher.
export async function createShow(title, createdById, createdByName) {
  return request('/shows', {
    method: 'POST',
    body: JSON.stringify({ title, createdById, createdByName }),
  })
}

// POST /api/shows/:id/join — add a roommate to a show's watcher list.
export async function joinShow(id, userId, userName) {
  return request(`/shows/${id}/join`, {
    method: 'POST',
    body: JSON.stringify({ userId, userName }),
  })
}

// POST /api/shows/:id/leave — remove a roommate from a show's watcher list.
export async function leaveShow(id, userId) {
  return request(`/shows/${id}/leave`, {
    method: 'POST',
    body: JSON.stringify({ userId }),
  })
}

// POST /api/shows/:id/complete — creator-only: mark a show completed so it
// leaves the active list. Returns the refreshed show list.
export async function completeShow(id, requesterId) {
  return request(`/shows/${id}/complete`, {
    method: 'POST',
    body: JSON.stringify({ requesterId }),
  })
}

// POST /api/shows/:id/reopen — creator-only: move a completed show back to the
// active list. Returns the refreshed show list.
export async function reopenShow(id, requesterId) {
  return request(`/shows/${id}/reopen`, {
    method: 'POST',
    body: JSON.stringify({ requesterId }),
  })
}

// PATCH /api/shows/:id/watchers/:memberId/:field — bump one watcher's season or
// episode by delta (+1 / -1). Any roommate in the show's group may edit any
// watcher's number; userId identifies the caller's group.
export async function adjustProgress(id, memberId, field, delta, userId) {
  return request(`/shows/${id}/watchers/${memberId}/${field}`, {
    method: 'PATCH',
    body: JSON.stringify({ delta, userId }),
  })
}

// PUT /api/shows/:id/watchers/:memberId/:field — set one watcher's season or
// episode to an absolute value. Backs the long-press manual editor.
export async function setProgress(id, memberId, field, value, userId) {
  return request(`/shows/${id}/watchers/${memberId}/${field}`, {
    method: 'PUT',
    body: JSON.stringify({ value, userId }),
  })
}
