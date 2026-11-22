# SeatRush

A ticket drop. One seat cannot be sold twice.

The API lives in `backend/`. The React app lives in `frontend/`. Docker Compose at the repo root starts both, plus PostgreSQL.

## Run everything

From the repo root:

```bash
docker compose up --build
```

- Web: http://localhost:5173
- API: http://localhost:3000
- OpenAPI: http://localhost:3000/docs

Demo Night at The Rialto is on sale when the API has finished starting. Open two browser windows, use a different name in each, and try the same seat.

## Backend

```bash
cd backend
npm ci
npm test
npm run build
npm start
```

`npm test` needs PostgreSQL and `DATABASE_URL`. Compose provides the database on port 5432. The API reads process environment only. Copy the names from the root `.env.example`, and for a process on the host set:

```bash
DATABASE_URL=postgres://seatrush:seatrush@localhost:5432/seatrush
```

`npm start` listens on port 3000 after `npm run build`.

## Frontend

```bash
cd frontend
npm ci
npm run dev
```

The dev server reads `frontend/.env.development`, which points `VITE_API_BASE_URL` at `http://localhost:3000`. Start the API first.

```bash
npm run build
npm run preview
```

`preview` serves the production bundle on http://localhost:5173. The same URL is baked in when Docker builds the frontend image.

## Test

```bash
docker compose --profile test run --rm --build test
```

That command migrates `seatrush_test`, does not seed the demo there, and runs the suite against real Postgres. The suite includes forty fans asking for B7 at once.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `HOLD_TTL_SECONDS` | 300 | How long a hold stays live |
| `MAX_SEATS_PER_USER` | 4 | Seats one fan may hold or buy for one show |
| `SWEEPER_ENABLED` | true | Tidies stale held rows. Correctness does not depend on it |

`HOLD_TTL_SECONDS` and `MAX_SEATS_PER_USER` must be integers of 1 or more. Anything else stops the process before it listens.

## Fans

The API identifies a fan by the `X-Fan-Username` header. The web app stores the name in `sessionStorage` under `fan`, so two windows are two fans. There is no password.

## On the seat page

Hold these seats, then Checkout or Cancel. Cancel releases the hold and the seats go back on sale. A coupon field accepts `SAVE10` (10 percent, half up to the nearest agora) and `WELCOME20` (20 shekels, once per fan). A hold that would leave one empty seat stuck on its own is refused, on the seat map and on the API, and that check cannot be turned off. Admin at http://localhost:5173/admin creates a show: name, the moment tickets go on sale, the show time, how many rows, how many seats in each row, and a price in shekels for each run of rows. That form calls `POST /events`, which writes the event, the zones, and every seat. The same page lists shows and can remove one after a confirm step, which deletes that show's seats, holds, and orders. It also lists fans and can delete one after a confirm step. Deleting a fan removes their holds and orders and returns those seats to sale. There is no password on that page.

## What this build does not do

No payment is taken. Checkout only marks the seats sold. The username header is a bearer token: anyone who can send it can act as that fan. Browsers poll the whole seat map, which will not carry 100,000 fans in the first minute.
