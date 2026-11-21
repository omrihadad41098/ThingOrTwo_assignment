import { PoolClient } from 'pg';
import { DomainError, seatConflict, SeatProblem, validation } from '../common/errors';
import { isLockNotAvailable } from '../db/database';
import { compareSeats, indexToLabel, SeatKey } from '../seats/seat-id';
import type { Cell } from './best-available';
import { createsNewLoneSeat, LONE_SEAT_MESSAGE } from './lone-seat';

export class LockBusy extends Error {}

type LockedSeat = {
  state: string;
  price_agorot: number;
  current_hold_id: string | null;
  holder_id: string | null;
  live: boolean;
};

export type CreatedHold = {
  id: string;
  eventId: string;
  expiresAt: string;
  serverNow: string;
  seatIds: string[];
  totalAgorot: number;
};

export async function createHoldOnSeats(
  client: PoolClient,
  input: {
    userId: string;
    username: string;
    eventId: string;
    seats: SeatKey[];
    ttlSeconds: number;
    maxSeats: number;
    lockMode: 'wait' | 'nowait';
    loneSeatRule?: boolean;
  },
): Promise<CreatedHold> {
  const seats = [...input.seats].sort(compareSeats);
  const event = await client.query<{ drop_at: Date; not_yet: boolean; seats_per_row: number }>(
    `SELECT drop_at, drop_at > now() AS not_yet, seats_per_row FROM events WHERE id = $1`,
    [input.eventId],
  );
  if (event.rowCount === 0) {
    throw new DomainError(404, 'NOT_FOUND', "We couldn't find that event.");
  }
  if (event.rows[0].not_yet) {
    throw new DomainError(
      409,
      'NOT_ON_SALE',
      `Tickets go on sale at ${event.rows[0].drop_at.toISOString()}.`,
    );
  }

  const used = await countUsed(client, input.userId, input.eventId);
  if (used + seats.length > input.maxSeats) {
    throw new DomainError(
      409,
      'LIMIT_EXCEEDED',
      `You can only hold ${input.maxSeats} seats for this show, and you already have ${used}.`,
    );
  }

  const locked: { seat: SeatKey; row: LockedSeat | null }[] = [];
  const rowPicture = new Map<number, (LockedSeat | null)[]>();
  if (input.loneSeatRule) {
    const seatsPerRow = Number(event.rows[0].seats_per_row);
    const rowIndexes = [...new Set(seats.map((seat) => seat.rowIndex))].sort((a, b) => a - b);
    for (const rowIndex of rowIndexes) {
      const picture: (LockedSeat | null)[] = [];
      for (let number = 1; number <= seatsPerRow; number++) {
        picture.push(await lockSeat(client, input, seatKey(rowIndex, number)));
      }
      rowPicture.set(rowIndex, picture);
    }
    for (const seat of seats) {
      const picture = rowPicture.get(seat.rowIndex) ?? [];
      locked.push({ seat, row: picture[seat.seatNumber - 1] ?? null });
    }
  } else {
    for (const seat of seats) {
      locked.push({ seat, row: await lockSeat(client, input, seat) });
    }
  }

  const problems: SeatProblem[] = [];
  for (const item of locked) {
    const reason = classify(item.row, input.userId);
    if (reason) problems.push({ id: item.seat.id, reason });
  }
  if (problems.length) throw seatConflict(problems, seats.length);
  if (input.loneSeatRule) assertNoNewLoneSeat(seats, rowPicture);

  const inserted = await client.query<{ id: string; expires_at: Date; server_now: Date }>(
    `INSERT INTO holds (event_id, user_id, status, expires_at)
     VALUES ($1, $2, 'active', now() + make_interval(secs => $3::int))
     RETURNING id, expires_at, now() AS server_now`,
    [input.eventId, input.userId, input.ttlSeconds],
  );
  const hold = inserted.rows[0];
  let total = 0;
  for (const item of locked) {
    const price = Number(item.row?.price_agorot ?? 0);
    total += price;
    await client.query(
      `INSERT INTO hold_seats (hold_id, event_id, row_index, seat_number)
       VALUES ($1, $2, $3, $4)`,
      [hold.id, input.eventId, item.seat.rowIndex, item.seat.seatNumber],
    );
    const updated = await client.query(
      `UPDATE seats
          SET state = 'held', current_hold_id = $4
        WHERE event_id = $1 AND row_index = $2 AND seat_number = $3
          AND state <> 'sold'
          AND current_hold_id IS NOT DISTINCT FROM $5::uuid`,
      [
        input.eventId,
        item.seat.rowIndex,
        item.seat.seatNumber,
        hold.id,
        item.row?.current_hold_id ?? null,
      ],
    );
    if (updated.rowCount !== 1) {
      const prefix = seats.length > 1 ? 'Nothing was held. ' : '';
      throw new DomainError(
        409,
        'SEAT_UNAVAILABLE',
        `${prefix}Someone just took ${item.seat.id}.`,
        [item.seat.id],
      );
    }
  }
  return {
    id: hold.id,
    eventId: input.eventId,
    expiresAt: hold.expires_at.toISOString(),
    serverNow: hold.server_now.toISOString(),
    seatIds: seats.map((seat) => seat.id),
    totalAgorot: total,
  };
}

export async function countUsed(
  client: PoolClient,
  userId: string,
  eventId: string,
): Promise<number> {
  const result = await client.query<{ used: string }>(
    `SELECT
       (SELECT count(*) FROM hold_seats hs
          JOIN holds h ON h.id = hs.hold_id
         WHERE h.user_id = $1 AND h.event_id = $2
           AND h.status = 'active' AND h.expires_at > now())
       +
       (SELECT count(*) FROM order_seats os
          JOIN orders o ON o.id = os.order_id
         WHERE o.user_id = $1 AND o.event_id = $2) AS used`,
    [userId, eventId],
  );
  return Number(result.rows[0].used);
}

export async function ensureUserLock(
  client: PoolClient,
  username: string,
  eventId: string,
): Promise<string> {
  await client.query(
    `INSERT INTO users (username) VALUES ($1) ON CONFLICT DO NOTHING`,
    [username],
  );
  const user = await client.query<{ id: string }>(
    'SELECT id FROM users WHERE username = $1',
    [username],
  );
  const userId = user.rows[0].id;
  await client.query(
    `INSERT INTO user_event_locks (user_id, event_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [userId, eventId],
  );
  await client.query(
    `SELECT 1 FROM user_event_locks WHERE user_id = $1 AND event_id = $2 FOR UPDATE`,
    [userId, eventId],
  );
  return userId;
}

export async function lockUserEvent(
  client: PoolClient,
  userId: string,
  eventId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO user_event_locks (user_id, event_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [userId, eventId],
  );
  await client.query(
    `SELECT 1 FROM user_event_locks WHERE user_id = $1 AND event_id = $2 FOR UPDATE`,
    [userId, eventId],
  );
}

function assertNoNewLoneSeat(
  seats: SeatKey[],
  rowPicture: Map<number, (LockedSeat | null)[]>,
): void {
  const byRow = new Map<number, SeatKey[]>();
  for (const seat of seats) {
    const group = byRow.get(seat.rowIndex) ?? [];
    group.push(seat);
    byRow.set(seat.rowIndex, group);
  }
  for (const [rowIndex, chosen] of byRow) {
    const picture = rowPicture.get(rowIndex) ?? [];
    const before: Cell[] = picture.map((row) => {
      if (!row || row.state === 'sold' || row.live) return 'taken';
      return 'free';
    });
    const taken = chosen.map((seat) => seat.seatNumber - 1);
    if (createsNewLoneSeat(before, taken)) {
      throw new DomainError(409, 'LONE_SEAT', LONE_SEAT_MESSAGE);
    }
  }
}

async function lockSeat(
  client: PoolClient,
  input: { eventId: string; lockMode: 'wait' | 'nowait' },
  seat: SeatKey,
): Promise<LockedSeat | null> {
  const nowait = input.lockMode === 'nowait' ? 'NOWAIT' : '';
  try {
    const result = await client.query<{
      state: string;
      price_agorot: number;
      current_hold_id: string | null;
    }>(
      `SELECT s.state, s.current_hold_id, z.price_agorot
         FROM seats s
         JOIN zones z ON z.id = s.zone_id
        WHERE s.event_id = $1 AND s.row_index = $2 AND s.seat_number = $3
        FOR UPDATE OF s ${nowait}`,
      [input.eventId, seat.rowIndex, seat.seatNumber],
    );
    const row = result.rows[0];
    if (!row) return null;
    if (!row.current_hold_id) {
      return {
        state: row.state,
        price_agorot: Number(row.price_agorot),
        current_hold_id: null,
        holder_id: null,
        live: false,
      };
    }
    const hold = await client.query<{ user_id: string; live: boolean }>(
      `SELECT user_id, (status = 'active' AND expires_at > now()) AS live
         FROM holds WHERE id = $1`,
      [row.current_hold_id],
    );
    return {
      state: row.state,
      price_agorot: Number(row.price_agorot),
      current_hold_id: row.current_hold_id,
      holder_id: hold.rows[0]?.user_id ?? null,
      live: hold.rows[0]?.live === true,
    };
  } catch (error) {
    if (input.lockMode === 'nowait' && isLockNotAvailable(error)) throw new LockBusy();
    throw error;
  }
}

function classify(row: LockedSeat | null, userId: string): SeatProblem['reason'] | null {
  if (!row) return 'missing';
  if (row.state === 'sold') return 'sold';
  if (row.live && row.holder_id === userId) return 'held_by_you';
  if (row.live && row.holder_id !== userId) return 'held_by_other';
  return null;
}

export function seatKey(rowIndex: number, seatNumber: number): SeatKey {
  return {
    rowIndex,
    seatNumber,
    id: `${indexToLabel(rowIndex)}${seatNumber}`,
  };
}

export function assertDistinct(seats: SeatKey[]): void {
  const seen = new Set<string>();
  for (const seat of seats) {
    if (seen.has(seat.id)) throw validation('List each seat once.');
    seen.add(seat.id);
  }
}
