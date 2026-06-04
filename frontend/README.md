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

## Tech

- [Vite](https://vitejs.dev/) + React 18
- [Tailwind CSS](https://tailwindcss.com/) (cozy theme tokens in
  `tailwind.config.js`)
- [React Router](https://reactrouter.com/) for `/login` and `/`

## Getting started

```bash
cd frontend
npm install
npm run dev
```

Open the printed local URL. Sign in as any roommate (Andre, Jordan, Maya, Sam,
Priya, Leo) with the demo password **`roomie`**.

## Backend / API

There is no server yet. All backend calls live in `src/api/client.js`, which
targets placeholder REST endpoints under `/api`:

| Function            | Method & path                     |
| ------------------- | --------------------------------- |
| `login`             | `POST /api/login`                 |
| `getRoommates`      | `GET /api/roommates`              |
| `updateStatus`      | `PUT /api/roommates/:id/status`   |

Until a real backend exists, these fall back to an in-memory mock
(`src/api/mock.js`) so the UI is fully functional; status changes persist to
`localStorage` for the session. To point at a real API:

```bash
# Run your server behind the Vite proxy and disable the mock
VITE_USE_MOCK=false VITE_API_TARGET=http://localhost:8000 npm run dev
```

## Scripts

- `npm run dev` — start the dev server
- `npm run build` — production build to `dist/`
- `npm run preview` — preview the production build
- `npm run lint` — lint the source
