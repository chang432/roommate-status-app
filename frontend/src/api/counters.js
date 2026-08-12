import { request } from "./request.js";

export function createCounter(payload) {
  return request("/counters", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getCounter(id, userId, cursor = "") {
  const params = new URLSearchParams({ userId, limit: "20" });
  if (cursor) params.set("cursor", cursor);
  return request(`/counters/${id}?${params}`);
}

export function addCounterEntry(id, payload) {
  return request(`/counters/${id}/entries`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateCounterEntry(id, entryId, userId, changes) {
  return request(`/counters/${id}/entries/${entryId}`, {
    method: "PATCH",
    body: JSON.stringify({ userId, changes }),
  });
}

export function deleteCounterEntry(id, entryId, userId) {
  return request(`/counters/${id}/entries/${entryId}`, {
    method: "DELETE",
    body: JSON.stringify({ userId }),
  });
}

function lifecycle(id, userId, action) {
  return request(`/counters/${id}/${action}`, {
    method: "POST",
    body: JSON.stringify({ userId }),
  });
}

export const archiveCounter = (id, userId) => lifecycle(id, userId, "archive");
export const restoreCounter = (id, userId) => lifecycle(id, userId, "restore");

export function deleteCounter(id, userId) {
  return request(`/counters/${id}`, {
    method: "DELETE",
    body: JSON.stringify({ userId }),
  });
}
