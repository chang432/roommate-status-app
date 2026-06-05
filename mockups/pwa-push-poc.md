# PWA + Push Notification PoC

Goal: convert the React/Vite webapp into an installable PWA and test web push
on an iPhone. Stack today: React/Vite frontend, Flask + DynamoDB backend, nginx
serving the build over HTTP.

## Core idea

A PWA is the existing app plus three things the browser recognizes:

1. **Web app manifest** (`manifest.json`) — name, icons, theme color,
   `display: standalone`. Makes iOS offer "Add to Home Screen" as a real app.
2. **Service worker** — background script that stays registered when the app is
   closed; receives push events and shows notifications.
3. **HTTPS** — required for service workers and push.

Push rides on the standard **Web Push API + VAPID**:

```
iPhone (installed PWA)              Flask backend           Apple Push Service
1. SW registers
2. User taps "enable"  --permission-->
3. pushManager.subscribe(VAPID pub)
   -> subscription obj  --POST /api/push/subscribe--> store in DynamoDB
   ... later, 3+ roommates free ...
                                     4. update_status() fires
                                        pywebpush(sub, payload, --encrypted push-->
                                        VAPID priv)                              |
5. SW 'push' event <----------------------------------------------------------- +
   -> showNotification()
```

**VAPID**: a public/private keypair generated once. Public key ships to the
browser at subscribe time; private key stays on the Flask server and signs each
push. No Apple developer account or APNs cert needed.

## iOS-specific gotchas (make-or-break)

- Push only works for an **installed** PWA (Add to Home Screen), not a Safari
  tab. Requires iOS 16.4+.
- **HTTPS with a real cert is mandatory.** `localhost` won't help — the iPhone
  is a separate device. Two options:
  - **Tunnel (fastest):** run locally, expose via `cloudflared`/`ngrok` for an
    instant `https://` URL. Zero infra change.
  - **`dev` VPS:** point a domain at it + add Let's Encrypt TLS to nginx.
    More setup, but reuses the new deploy workflow.
- Permission must come from a **user gesture** inside the installed app; iOS
  won't easily re-prompt once dismissed.

## Codebase changes

- **Frontend:** add `manifest.json` + icons in `public/`, register a service
  worker (`vite-plugin-pwa` automates most), add an "Enable notifications"
  button that subscribes and POSTs the subscription to the backend.
- **Backend (`app.py` / `db.py`):** add `pywebpush` + `cryptography` deps; add
  `POST /api/push/subscribe` (+ optional `/unsubscribe`); store subscriptions
  in DynamoDB; wire the `send` call into `update_status` where it currently just
  logs `"Notification: %d roommates are available"` (app.py:82-83).
- **Infra:** VAPID keys as secrets/env vars; pick the HTTPS approach above.

## Open decision

The whole test hinges on how HTTPS reaches the iPhone (tunnel vs. dev VPS).
Everything else (manifest, SW, VAPID, endpoints) is identical either way.
Default recommendation for a PoC: the tunnel, lowest friction.
