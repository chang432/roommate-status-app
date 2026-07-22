import { request, withQuery } from "./request.js";

export function getShows(userId) {
  return request(withQuery("/shows", { userId }));
}

export function createShow(title, createdById, createdByName) {
  return request("/shows", { method: "POST", body: JSON.stringify({ title, createdById, createdByName }) });
}

export function joinShow(id, userId, userName) {
  return request(`/shows/${id}/join`, { method: "POST", body: JSON.stringify({ userId, userName }) });
}

export function leaveShow(id, userId) {
  return request(`/shows/${id}/leave`, { method: "POST", body: JSON.stringify({ userId }) });
}

export function archiveShow(id, requesterId) {
  return request(`/shows/${id}/archive`, { method: "POST", body: JSON.stringify({ requesterId }) });
}

export function restoreShow(id, requesterId) {
  return request(`/shows/${id}/restore`, { method: "POST", body: JSON.stringify({ requesterId }) });
}

export function deleteShow(id, requesterId) {
  return request(`/shows/${id}`, { method: "DELETE", body: JSON.stringify({ requesterId }) });
}

export function startWatchparty(id, requesterId, season, episode) {
  return request(`/shows/${id}/watchparty/start`, {
    method: "POST",
    body: JSON.stringify({ requesterId, season, episode }),
  });
}

export function endWatchparty(id, requesterId) {
  return request(`/shows/${id}/watchparty/end`, { method: "POST", body: JSON.stringify({ requesterId }) });
}

export function adjustProgress(id, memberId, field, delta, userId) {
  return request(`/shows/${id}/watchers/${memberId}/${field}`, {
    method: "PATCH",
    body: JSON.stringify({ delta, userId }),
  });
}

export function setProgress(id, memberId, field, value, userId) {
  return request(`/shows/${id}/watchers/${memberId}/${field}`, {
    method: "PUT",
    body: JSON.stringify({ value, userId }),
  });
}
