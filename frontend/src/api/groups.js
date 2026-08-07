import { request, withQuery } from "./request.js";

export function joinGroup(userId, code) {
  return request("/groups/join", { method: "POST", body: JSON.stringify({ userId, code }) });
}

export function createGroup(userId, name) {
  return request("/groups", { method: "POST", body: JSON.stringify({ userId, name }) });
}

export function getGroups(userId) {
  return request(withQuery("/groups", { userId }));
}

export function getCurrentGroup(userId) {
  return request(withQuery("/groups/current", { userId }));
}

export function renameGroup(userId, name) {
  return request(withQuery("/groups/current", { userId }), {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

export function updateGroupModules(userId, enabledModules) {
  return request(withQuery("/groups/modules", { userId }), {
    method: "PUT",
    body: JSON.stringify({ enabledModules }),
  });
}

export function updateGroupTheme(userId, theme) {
  return request(withQuery("/groups/theme", { userId }), {
    method: "PUT",
    body: JSON.stringify({ theme }),
  });
}

export function removeGroupMember(actorId, userId) {
  return request(withQuery(`/groups/members/${userId}`, { userId: actorId }), { method: "DELETE" });
}

export function setGroupMemberRole(actorId, userId, role) {
  return request(withQuery(`/groups/members/${userId}/role`, { userId: actorId }), {
    method: "PUT",
    body: JSON.stringify({ role }),
  });
}
