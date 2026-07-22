import { request } from "./request.js";

export function getVapidPublicKey() {
  return request("/push/public-key");
}

export function savePushSubscription(subscription, userId) {
  return request("/push/subscribe", {
    method: "POST",
    body: JSON.stringify({ subscription, userId }),
  });
}
