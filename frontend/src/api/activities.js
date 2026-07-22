import { request, withQuery } from "./request.js";

export function getActivities(userId, groupId) {
  return request(withQuery("/activities", { userId }), {
    headers: groupId ? { "X-Roomie-Group-ID": groupId } : undefined,
  });
}

export function proposeActivity(text, proposedById, startAt = null, endAt = null) {
  return request("/activities", {
    method: "POST",
    body: JSON.stringify({ text, proposedById, startAt, endAt }),
  });
}

export function archiveActivity(id, requesterId) {
  return request(`/activities/${id}/archive`, { method: "POST", body: JSON.stringify({ requesterId }) });
}

export function restoreActivity(id, requesterId) {
  return request(`/activities/${id}/restore`, { method: "POST", body: JSON.stringify({ requesterId }) });
}

export function deleteActivity(id, requesterId) {
  return request(`/activities/${id}`, { method: "DELETE", body: JSON.stringify({ requesterId }) });
}

export function startActivity(id, requesterId) {
  return request(`/activities/${id}/start`, { method: "POST", body: JSON.stringify({ requesterId }) });
}

export function endActivity(id, requesterId) {
  return request(`/activities/${id}/end`, { method: "POST", body: JSON.stringify({ requesterId }) });
}

export function joinActivity(id, userId) {
  return request(`/activities/${id}/join`, { method: "POST", body: JSON.stringify({ userId }) });
}

export function leaveActivity(id, userId) {
  return request(`/activities/${id}/leave`, { method: "POST", body: JSON.stringify({ userId }) });
}

export function commentOnActivity(id, authorId, text) {
  return request(`/activities/${id}/comments`, { method: "POST", body: JSON.stringify({ authorId, text }) });
}

export function setCommentLiked(id, commentId, userId, liked) {
  return request(`/activities/${id}/comments/${commentId}/likes`, {
    method: liked ? "PUT" : "DELETE",
    body: JSON.stringify({ userId }),
  });
}
