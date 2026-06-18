# York Terrace Roomie Status — Frontend

A small React + Tailwind CSS web app where housemates set and view each other's
availability to hang out. Built from the mockups in `../mockups`.

## Features

- **Login** by picking your name and entering a password.
- **View** the whole household's current statuses at a glance.
- **Set your status**: _Available to hang_, _Busy with something_, or a custom
  message.
- **Gather banner**: when 3+ roommates are available, a notification banner
  invites everyone to hang out (PROJECT.md threshold).
- **Live events**: event creators can start/end an event, with one live-event
  banner shown household-wide. Open apps refresh from live-event push messages,
  focus changes, or visible-page polling.
- **Comment mentions**: typing `@` suggests household members, highlights valid
  mentions, and notifies the mentioned roommates.

## Tech

- [Vite](https://vitejs.dev/) + React 18
- [Tailwind CSS](https://tailwindcss.com/) (cozy theme tokens in
  `tailwind.config.js`)
- [React Router](https://reactrouter.com/) for `/login` and `/`

## Getting started

Start the [Flask backend](../docker/flask) first (it serves the API on
`http://localhost:8000`, the Vite proxy target), then run the frontend:

```bash
cd frontend
npm install
npm run dev
```

Open the printed local URL. Sign in as any roommate (Andre, Jordan, Maya, Sam,
Priya, Leo) with the demo password **`roomie`**.

## Backend / API

All backend calls live in `src/api/client.js`, which targets the Flask server
(`../docker/flask`) under `/api`:

| Function            | Method & path                     |
| ------------------- | --------------------------------- |
| `login`             | `POST /api/login`                 |
| `getRoommates`      | `GET /api/roommates`              |
| `updateStatus`      | `PUT /api/roommates/:id/status`   |
| `notifyRoommatesToUpdateStatus` | `POST /api/roommates/notify` |
| `proposeActivity`   | `POST /api/activities`            |
| `deleteActivity`    | `DELETE /api/activities/:id`      |
| `startActivity`     | `POST /api/activities/:id/start`  |
| `endActivity`       | `POST /api/activities/:id/end`    |

In dev, Vite proxies `/api` to the backend (default `http://localhost:8000`).
Point at a different server with `VITE_API_TARGET`:

```bash
VITE_API_TARGET=http://localhost:9000 npm run dev
```

## Scripts

- `npm run dev` — start the dev server
- `npm run build` — production build to `dist/`
- `npm run preview` — preview the production build
- `npm run lint` — lint the source
