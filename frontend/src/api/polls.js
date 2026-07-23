import { request } from "./request.js";

export function createPoll(title, createdById, options) {
  return request("/polls", {
    method: "POST",
    body: JSON.stringify({ title, createdById, options }),
  });
}

export function addPollOption(id, userId, text) {
  return request(`/polls/${id}/options`, {
    method: "POST",
    body: JSON.stringify({ userId, text }),
  });
}

export function editPollOption(id, optionId, userId, text) {
  return request(`/polls/${id}/options/${optionId}`, {
    method: "PATCH",
    body: JSON.stringify({ userId, text }),
  });
}

export function setPollVote(id, optionId, userId, selected) {
  return request(`/polls/${id}/options/${optionId}/votes`, {
    method: selected ? "PUT" : "DELETE",
    body: JSON.stringify({ userId }),
  });
}

export function commentOnPoll(id, authorId, text) {
  return request(`/polls/${id}/comments`, {
    method: "POST",
    body: JSON.stringify({ authorId, text }),
  });
}

export function setPollCommentLiked(id, commentId, userId, liked) {
  return request(`/polls/${id}/comments/${commentId}/likes`, {
    method: liked ? "PUT" : "DELETE",
    body: JSON.stringify({ userId }),
  });
}

export function archivePoll(id, userId) {
  return request(`/polls/${id}/archive`, {
    method: "POST",
    body: JSON.stringify({ userId }),
  });
}

export function restorePoll(id, userId) {
  return request(`/polls/${id}/restore`, {
    method: "POST",
    body: JSON.stringify({ userId }),
  });
}

export function deletePoll(id, userId) {
  return request(`/polls/${id}`, {
    method: "DELETE",
    body: JSON.stringify({ userId }),
  });
}
