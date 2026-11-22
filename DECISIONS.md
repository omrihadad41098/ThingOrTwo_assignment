# Decisions

## Modules and the hold flow

NestJS exposes the HTTP API. React renders the four screens. PostgreSQL is the only place a hold or a sale is decided. A fan asks for specific seats or for the best block. The API locks that fan's row for the event, locks the seats in row order, and inserts the hold in the same transaction. Checkout locks the fan, then the hold, then the seats, and inserts one order. A second checkout of the same hold returns that order.

## Tables

`seats` is the mutex and the map. `holds` and `hold_seats` record who asked. `orders.hold_id` is unique, so a hold becomes one purchase. Prices live on the zone until sale, then `order_seats.price_agorot` freezes them. `user_event_locks` is only a row to lock. It is not a counter. The cap is a count of live hold seats plus purchased seats, taken while that row is locked.

## Double-selling and expiry

A seat is free when it is not sold and it has no live hold. Live means `status = 'active'` and `expires_at > now()` inside the database. The update that marks a seat held also requires the pointer we read, so a concurrent claim makes the loser roll back. At `expires_at`, checkout fails if no order exists, and the map shows the seat as available. A sweeper may clear the stale `held` flag later. It is not required for that answer. There is no `expired` status.

The schema does not constrain `expires_at` to be after `created_at`. The tests move `expires_at` into the past, which is before the row was created.

## Assumptions

Fans are a header, not accounts. Money is integer agorot. A hold is 1 to 4 seats, all or nothing. Events do not change after they are created. Zones cover every row once. The drop is before the show. SAVE10 and WELCOME20 are applied at checkout. An unknown or reused code leaves the hold in place. The lone-seat rule is always on. A hold that would leave one empty seat stuck on its own is refused, including best available, and a request cannot turn the rule off. On the brief's room the answer is C4-C5.

## Stack

NestJS and `pg`, with SQL written out, because the grade is the transaction. Zod checks request bodies. React, TypeScript, and React Router, with one stylesheet. PostgreSQL 16. Docker Compose runs the database, the API, the web app, and the test profile.

## Before a real launch

Real sessions, and an admin who is authenticated. Take payment in the same transaction that sells the seat. A waiting room. Push seat changes instead of polling. Managed Postgres and backups. An audit log. Rate limits shared by every API copy. The username header is an impersonation path.

## 100,000 fans in the first minute

The map poll breaks first. That many browsers asking for the whole room is on the order of 50,000 queries a second. Writes fail second, and they fail closed: the lock timeout and the pool tell the fan to retry. Best available piles onto the front rows. Commits still take the seat lock, so nobody is double-booked. The launch change is a waiting room and a push of seat deltas.

## Three API copies

The protection holds. The seat lock, the per-fan lock, the unique order, and the clock are in PostgreSQL. No sticky sessions. Three sweepers skip each other with an advisory lock. Three boots share the migration lock, so Demo Night is inserted once. Three copies do not fix the poll storm.
