import { request, withQuery } from "./request.js";

export function getFeed(userId, type = "all", groupId) {
  return request(withQuery("/feed", { userId, type }), {
    headers: groupId ? { "X-Roomie-Group-ID": groupId } : undefined,
  });
}

export function updateModule(type, id, editorId, changes) {
  return request(`/modules/${type}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ editorId, changes }),
  });
}
