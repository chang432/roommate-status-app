import { request, withQuery } from "./request.js";

export function getRoommates(userId, groupId) {
  return request(withQuery("/roommates", { userId }), {
    headers: groupId ? { "X-Roomie-Group-ID": groupId } : undefined,
  });
}

export function updateStatus(id, status, statusText) {
  return request(`/roommates/${id}/status`, {
    method: "PUT",
    body: JSON.stringify({ status, statusText }),
  });
}

export function notifyRoommatesToUpdateStatus(requesterId) {
  return request("/roommates/notify", { method: "POST", body: JSON.stringify({ requesterId }) });
}

export function pokeRoommate(id, requesterId) {
  return request(`/roommates/${id}/poke`, { method: "POST", body: JSON.stringify({ requesterId }) });
}
