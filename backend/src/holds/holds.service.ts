import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { DomainError, notFound, validation } from '../common/errors';
import { Database } from '../db/database';
import { chooseBlock, Cell, SeatRow } from './best-available';
import {
  assertDistinct,
  createHoldOnSeats,
  CreatedHold,
  ensureUserLock,
  LockBusy,
  seatKey,
} from './create-hold';
import { indexToLabel, parseSeatId, SeatKey } from '../seats/seat-id';

const bestAvailableSchema = z.object({
  count: z.number().int(),
  maxPriceAgorot: z.number().int().nonnegative().optional(),
  zoneId: z.string().uuid().optional(),
});

export const holdBodySchema = z.object({
  seatIds: z.array(z.string()).optional(),
  bestAvailable: bestAvailableSchema.optional(),
});

export type HoldBody = z.infer<typeof holdBodySchema>;

@Injectable()
export class HoldsService {
  constructor(private readonly db: Database) {}

  create(eventId: string, username: string, body: HoldBody): Promise<CreatedHold> {
    const explicit = body.seatIds != null;
    const best = body.bestAvailable != null;
    if (explicit === best) {
      throw validation('Send either seatIds or bestAvailable.');
    }
    if (explicit) {
      const seats = this.parseExplicit(body.seatIds ?? []);
      return this.db.withWriteTransaction(async (client) => {
        await this.requireEvent(client, eventId);
        const userId = await ensureUserLock(client, username, eventId);
        return createHoldOnSeats(client, {
          userId,
          username,
          eventId,
          seats,
          ttlSeconds: this.db.env.holdTtlSeconds,
          maxSeats: this.db.env.maxSeatsPerUser,
          lockMode: 'wait',
        });
      });
    }
    const request = body.bestAvailable!;
    if (request.count < 1 || request.count > 4) {
      throw validation('A hold is 1 to 4 seats.');
    }
    return this.db.withWriteTransaction(async (client) => {
      await this.requireEvent(client, eventId);
      await ensureUserLock(client, username, eventId);
      return this.probeBestAvailable(client, eventId, username, request);
    });
  }

  async release(holdId: string, username: string) {
    const peek = await this.db.withRead((client) => this.peekHold(client, holdId));
    return this.db.withWriteTransaction(async (client) => {
      const user = await this.findUser(client, username);
      if (!user || user.id !== peek.user_id) {
        throw new DomainError(403, 'FORBIDDEN', 'This hold belongs to another fan.');
      }
      await client.query(
        `SELECT 1 FROM user_event_locks WHERE user_id = $1 AND event_id = $2 FOR UPDATE`,
        [user.id, peek.event_id],
      );
      const hold = await this.lockHold(client, holdId);
      if (hold.user_id !== user.id) {
        throw new DomainError(403, 'FORBIDDEN', 'This hold belongs to another fan.');
      }
      const seats = await this.holdSeatIds(client, holdId);
      if (hold.status === 'released') {
        return { id: hold.id, status: 'released' as const, seatIds: seats };
      }
      if (hold.status === 'converted') {
        throw new DomainError(409, 'HOLD_CLOSED', 'These seats are already bought.');
      }
      if (hold.expired) {
        throw new DomainError(
          409,
          'HOLD_EXPIRED',
          'Your hold has expired. These seats are back on sale.',
        );
      }
      await this.lockHoldSeats(client, holdId);
      await client.query(`UPDATE holds SET status = 'released' WHERE id = $1`, [holdId]);
      const freed = await client.query(
        `UPDATE seats
            SET state = 'available', current_hold_id = NULL
          WHERE current_hold_id = $1 AND state = 'held'`,
        [holdId],
      );
      if (freed.rowCount !== seats.length) {
        throw new DomainError(409, 'SEAT_UNAVAILABLE', 'Someone just took these seats.');
      }
      return { id: hold.id, status: 'released' as const, seatIds: seats };
    });
  }

  private parseExplicit(rawIds: string[]): SeatKey[] {
    if (rawIds.length < 1 || rawIds.length > 4) {
      throw validation('A hold is 1 to 4 seats.');
    }
    const seats: SeatKey[] = [];
    for (const raw of rawIds) {
      const seat = parseSeatId(raw);
      if (!seat) throw validation('Seat ids look like B7.');
      seats.push(seat);
    }
    assertDistinct(seats);
    return seats;
  }

  private async probeBestAvailable(
    client: PoolClient,
    eventId: string,
    username: string,
    request: z.infer<typeof bestAvailableSchema>,
  ): Promise<CreatedHold> {
    const user = await client.query<{ id: string }>(
      'SELECT id FROM users WHERE username = $1',
      [username],
    );
    const userId = user.rows[0].id;
    let lockedMisses = 0;
    for (let attempt = 0; attempt < 8; attempt++) {
      const rows = await this.loadRows(client, eventId);
      const choice = chooseBlock({
        rows,
        count: request.count,
        maxPriceAgorot: request.maxPriceAgorot,
        zoneId: request.zoneId,
        loneSeatRule: true,
      });
      if (!choice) {
        throw new DomainError(
          409,
          'NO_BLOCK',
          `No ${request.count} seats together are free in that price range.`,
        );
      }
      const seats: SeatKey[] = [];
      for (let offset = 0; offset < request.count; offset++) {
        seats.push(seatKey(choice.rowIndex, choice.startNumber + offset));
      }
      await client.query('SAVEPOINT probe');
      try {
        const created = await createHoldOnSeats(client, {
          userId,
          username,
          eventId,
          seats,
          ttlSeconds: this.db.env.holdTtlSeconds,
          maxSeats: this.db.env.maxSeatsPerUser,
          lockMode: 'nowait',
        });
        await client.query('RELEASE SAVEPOINT probe');
        return created;
      } catch (error) {
        await client.query('ROLLBACK TO SAVEPOINT probe');
        await client.query('RELEASE SAVEPOINT probe');
        const retry =
          error instanceof LockBusy ||
          (error instanceof DomainError &&
            (error.code === 'SEAT_UNAVAILABLE' || error.code === 'LONE_SEAT'));
        if (!retry) throw error;
        lockedMisses += 1;
      }
    }
    if (lockedMisses >= 8) {
      throw new DomainError(
        503,
        'BUSY',
        'Too many people are trying for these seats. Please try again.',
      );
    }
    throw new DomainError(
      409,
      'NO_BLOCK',
      `No ${request.count} seats together are free in that price range.`,
    );
  }

  private async loadRows(client: PoolClient, eventId: string): Promise<SeatRow[]> {
    const result = await client.query<{
      row_index: number;
      seat_number: number;
      zone_id: string;
      price_agorot: number;
      cell: Cell;
    }>(
      `SELECT s.row_index, s.seat_number, s.zone_id, z.price_agorot,
              CASE
                WHEN s.state = 'sold' THEN 'taken'
                WHEN s.state = 'held' AND h.status = 'active' AND h.expires_at > now() THEN 'taken'
                ELSE 'free'
              END AS cell
         FROM seats s
         JOIN zones z ON z.id = s.zone_id
         LEFT JOIN holds h ON h.id = s.current_hold_id
        WHERE s.event_id = $1
        ORDER BY s.row_index, s.seat_number`,
      [eventId],
    );
    const rows = new Map<number, SeatRow>();
    for (const seat of result.rows) {
      let row = rows.get(seat.row_index);
      if (!row) {
        row = {
          index: seat.row_index,
          cells: [],
          priceAgorot: Number(seat.price_agorot),
          zoneId: seat.zone_id,
        };
        rows.set(seat.row_index, row);
      }
      row.cells[seat.seat_number - 1] = seat.cell;
    }
    return [...rows.values()].sort((a, b) => a.index - b.index);
  }

  private async requireEvent(client: PoolClient, eventId: string): Promise<void> {
    const found = await client.query('SELECT 1 FROM events WHERE id = $1', [eventId]);
    if (found.rowCount === 0) {
      throw notFound("We couldn't find that event.");
    }
  }

  private async peekHold(client: PoolClient, holdId: string) {
    const result = await client.query<{ id: string; event_id: string; user_id: string }>(
      'SELECT id, event_id, user_id FROM holds WHERE id = $1',
      [holdId],
    );
    if (result.rowCount === 0) throw notFound("We couldn't find that hold.");
    return result.rows[0];
  }

  private async findUser(client: PoolClient, username: string) {
    const result = await client.query<{ id: string }>(
      'SELECT id FROM users WHERE username = $1',
      [username],
    );
    return result.rows[0] ?? null;
  }

  private async lockHold(client: PoolClient, holdId: string) {
    const result = await client.query<{
      id: string;
      user_id: string;
      status: string;
      expired: boolean;
    }>(
      `SELECT id, user_id, status, expires_at <= now() AS expired
         FROM holds WHERE id = $1 FOR UPDATE`,
      [holdId],
    );
    if (result.rowCount === 0) throw notFound("We couldn't find that hold.");
    return result.rows[0];
  }

  private async holdSeatIds(client: PoolClient, holdId: string): Promise<string[]> {
    const seats = await client.query<{ row_index: number; seat_number: number }>(
      `SELECT row_index, seat_number FROM hold_seats
        WHERE hold_id = $1 ORDER BY row_index, seat_number`,
      [holdId],
    );
    return seats.rows.map((seat) => `${indexToLabel(seat.row_index)}${seat.seat_number}`);
  }

  private async lockHoldSeats(client: PoolClient, holdId: string): Promise<void> {
    await client.query(
      `SELECT s.row_index FROM seats s
         JOIN hold_seats hs
           ON hs.event_id = s.event_id
          AND hs.row_index = s.row_index
          AND hs.seat_number = s.seat_number
        WHERE hs.hold_id = $1
        ORDER BY s.row_index, s.seat_number
        FOR UPDATE OF s`,
      [holdId],
    );
  }
}
