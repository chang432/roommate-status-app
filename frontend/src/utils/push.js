// Web Push helpers: register the service worker, then (on a user gesture)
// request permission and subscribe this device with the backend.
import { getVapidPublicKey, savePushSubscription } from '../api/client.js'

// Push needs a service worker + the Push API + the Notifications API. iOS only
// exposes these inside an installed (Add to Home Screen) PWA, so an ordinary
// Safari tab reports unsupported — which is the cue to prompt for install.
export function pushSupported() {
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

// VAPID public keys are base64url; the Push API wants a Uint8Array.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i)
  return output
}

// Register the service worker once, early. Safe to call on every load.
export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null
  try {
    return await navigator.serviceWorker.register('/service-worker.js')
  } catch (err) {
    console.error('Service worker registration failed', err)
    return null
  }
}

// Full subscribe flow. MUST be called from a user gesture (a tap) — iOS will
// otherwise refuse the permission prompt. Returns the resulting Notification
// permission ('granted' | 'denied' | 'default').
export async function enablePush() {
  if (!pushSupported()) throw new Error('unsupported')

  const registration =
    (await navigator.serviceWorker.getRegistration()) ||
    (await registerServiceWorker())
  if (!registration) throw new Error('no-service-worker')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission

  // Reuse an existing subscription if the browser already has one.
  let subscription = await registration.pushManager.getSubscription()
  if (!subscription) {
    const { publicKey } = await getVapidPublicKey()
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    })
  }

  await savePushSubscription(subscription)
  return permission
}
