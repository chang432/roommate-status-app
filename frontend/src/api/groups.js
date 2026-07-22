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

export function updateGroupDisplay(userId, showRoster, showFeed, showBookClub) {
  return request(withQuery("/groups/display", { userId }), {
    method: "PUT",
    body: JSON.stringify({ showRoster, showFeed, showBookClub }),
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
