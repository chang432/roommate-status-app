import { request, withQuery } from "./request.js";

export function getForums(userId) {
  return request(withQuery("/forums", { userId }));
}

export function createForum(title, bookId, createdById) {
  return request("/forums", {
    method: "POST",
    body: JSON.stringify({ title, bookId, createdById }),
  });
}

export function updateForum(id, editorId, title, bookId) {
  return request(`/modules/forums/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ editorId, changes: { title, bookId } }),
  });
}

export function commentOnForum(id, authorId, text) {
  return request(`/forums/${encodeURIComponent(id)}/comments`, {
    method: "POST",
    body: JSON.stringify({ authorId, text }),
  });
}

export function setForumCommentLiked(id, commentId, userId, liked) {
  return request(
    `/forums/${encodeURIComponent(id)}/comments/${encodeURIComponent(commentId)}/likes`,
    {
      method: liked ? "PUT" : "DELETE",
      body: JSON.stringify({ userId }),
    },
  );
}

function lifecycle(id, userId, action) {
  return request(`/forums/${encodeURIComponent(id)}/${action}`, {
    method: "POST",
    body: JSON.stringify({ userId }),
  });
}

export function archiveForum(id, userId) {
  return lifecycle(id, userId, "archive");
}

export function restoreForum(id, userId) {
  return lifecycle(id, userId, "restore");
}

export function deleteForum(id, userId) {
  return request(`/forums/${encodeURIComponent(id)}`, {
    method: "DELETE",
    body: JSON.stringify({ userId }),
  });
}
