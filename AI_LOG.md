# AI log

Cursor drafted the design note and the Nest and React code in this repo. I checked those drafts against the brief, the Postgres tests, and the running app. No other AI tool was used.

## Kept

Postgres is the only place a seat is claimed. The draft's alternative, a lock in the Node process or in Redis, dies when a second API copy starts, and the brief asks whether three copies still protect a seat. The kept version is `SELECT … FOR UPDATE` in row order, a unique `orders.hold_id`, and advisory locks for migrate and the sweeper.

Money stays integer agorot. SAVE10 is `Math.floor((subtotal * 10 + 50) / 100)`, not a float.

## Changed

The first seat update only skipped rows already marked sold. Forty fans asked for B7 at once and every request returned 201, because a transaction that had waited could still write. The update now matches the hold pointer read under the row lock, and whether that hold is still live is read again after the lock. One fan wins.

The design had the lone-seat rule as an env flag, then as a per-tab OneSeatMode switch that defaulted off so best available stayed B2-B3. That switch is gone. The hold transaction always judges the row, `oneSeatMode` in the body is ignored, and there is no env flag that turns the rule off. The brief's room therefore returns C4-C5. The seat page uses the same check and refuses the click.

The name chips were a `localStorage` list. Deleting a fan left the name on the gate after a refresh. The gate now renders `GET /admin/users` and rewrites the cache down to names that response still contains.

The first required build answered any coupon with `Promo codes aren't available yet.` Once SAVE10 and WELCOME20 were in scope, that short-circuit came out. An unknown or reused code is 409 and the hold stays.

The apps moved from `api/` and `web/` to `backend/` and `frontend/`. Compose service names stayed `api` and `web`, so the database host and the test profile did not have to change.

## Rejected

`CHECK (expires_at > created_at)` was in the design draft. The tests set `expires_at` a second in the past, which is before `created_at`, and the check rejects that update. Expiry is `expires_at > now()` inside the query. There is no `expired` status.

Treating every unique violation as a checkout replay was wrong. A collision on `promo_redemptions` is `PROMO_USED` and the hold stays live. Only `orders_hold_id_key` returns the existing order.

The first best-available test bought eight seats as one fan and got `LIMIT_EXCEEDED`. The cap is 4. The room was split across four fans. The picker was left as it was.

The first design PDF was 31 pages, and a later HTML save put the shekel sign and en dashes in as the wrong bytes. The note was cut down and kept ASCII. The PDF is a print of that file.
