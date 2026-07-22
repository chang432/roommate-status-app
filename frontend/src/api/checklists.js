import { request } from "./request.js";

export function createChecklist(title, createdById, items) {
  return request("/checklists", { method: "POST", body: JSON.stringify({ title, createdById, items }) });
}

export function notifyChecklist(id, requesterId) {
  return request(`/checklists/${id}/notify`, { method: "POST", body: JSON.stringify({ requesterId }) });
}

export function addChecklistItem(id, userId, text) {
  return request(`/checklists/${id}/items`, { method: "POST", body: JSON.stringify({ userId, text }) });
}

export function toggleChecklistItem(id, itemId, userId) {
  return request(`/checklists/${id}/items/${itemId}/toggle`, { method: "POST", body: JSON.stringify({ userId }) });
}

export function updateChecklistItem(id, itemId, userId, text) {
  return request(`/checklists/${id}/items/${itemId}`, { method: "PATCH", body: JSON.stringify({ userId, text }) });
}

export function deleteChecklistItem(id, itemId, userId) {
  return request(`/checklists/${id}/items/${itemId}`, { method: "DELETE", body: JSON.stringify({ userId }) });
}

export function archiveChecklist(id, userId) {
  return request(`/checklists/${id}/archive`, { method: "POST", body: JSON.stringify({ userId }) });
}

export function restoreChecklist(id, userId) {
  return request(`/checklists/${id}/restore`, { method: "POST", body: JSON.stringify({ userId }) });
}

export function deleteChecklist(id, userId) {
  return request(`/checklists/${id}`, { method: "DELETE", body: JSON.stringify({ userId }) });
}
