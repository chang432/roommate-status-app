import { request } from "./request.js";

export function login(username, password) {
  return request("/login", { method: "POST", body: JSON.stringify({ username, password }) });
}

export function createAccount(username, name, password) {
  return request("/accounts", { method: "POST", body: JSON.stringify({ username, name, password }) });
}

export function getAccount(id) {
  return request(`/accounts/${id}`);
}

export function deleteAccount(id, password) {
  return request(`/accounts/${id}`, { method: "DELETE", body: JSON.stringify({ password }) });
}
