import { request, withQuery } from "./request.js";

export function getJam(userId) {
  return request(withQuery("/jam", { userId }));
}

export function shareJam(link, hostId) {
  return request("/jam", { method: "POST", body: JSON.stringify({ link, hostId }) });
}

export function endJam(hostId) {
  return request("/jam", { method: "DELETE", body: JSON.stringify({ hostId }) });
}
