import { request } from "./request.js";

export function createRequest(text, requesterId, requestedIds) {
  return request("/requests", { method: "POST", body: JSON.stringify({ text, requesterId, requestedIds }) });
}

export function respondToRequest(id, userId, response) {
  return request(`/requests/${id}/responses`, { method: "POST", body: JSON.stringify({ userId, response }) });
}

export function archiveRequest(id, userId) {
  return request(`/requests/${id}/archive`, { method: "POST", body: JSON.stringify({ userId }) });
}

export function restoreRequest(id, userId) {
  return request(`/requests/${id}/restore`, { method: "POST", body: JSON.stringify({ userId }) });
}

export function deleteRequest(id, requesterId) {
  return request(`/requests/${id}`, { method: "DELETE", body: JSON.stringify({ requesterId }) });
}

export function commentOnRequest(id, authorId, text) {
  return request(`/requests/${id}/comments`, { method: "POST", body: JSON.stringify({ authorId, text }) });
}

export function setRequestCommentLiked(id, commentId, userId, liked) {
  return request(`/requests/${id}/comments/${commentId}/likes`, {
    method: liked ? "PUT" : "DELETE",
    body: JSON.stringify({ userId }),
  });
}
