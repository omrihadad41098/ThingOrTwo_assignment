import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DomainError, validation } from '../common/errors';
import { Database } from '../db/database';
import { indexToLabel, labelToIndex } from '../seats/seat-id';

const zoneSchema = z.object({
  name: z.string().trim().min(1).max(80),
  fromRow: z.string().trim().min(1),
  toRow: z.string().trim().min(1),
  priceAgorot: z.number().int().nonnegative(),
});

export const createEventSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(120),
  venue: z.string().trim().min(1, 'Venue is required.').max(120),
  startsAt: z.string().min(1),
  dropAt: z.string().min(1),
  rowCount: z.number().int(),
  seatsPerRow: z.number().int(),
  zones: z.array(zoneSchema).min(1, 'Add at least one zone.'),
});

export type CreateEventInput = z.infer<typeof createEventSchema>;

type ZoneRow = {
  id: string;
  name: string;
  from_row: number;
  to_row: number;
  price_agorot: number;
};

@Injectable()
export class EventsService {
  constructor(private readonly db: Database) {}

  async create(input: CreateEventInput) {
    const startsAt = parseTime(input.startsAt, 'startsAt');
    const dropAt = parseTime(input.dropAt, 'dropAt');
    if (dropAt >= startsAt) {
      throw validation('The drop must be before the show starts.');
    }
    if (input.rowCount < 1 || input.rowCount > 60) {
      throw validation('Row count must be between 1 and 60.');
    }
    if (input.seatsPerRow < 1 || input.seatsPerRow > 100) {
      throw validation('Seats per row must be between 1 and 100.');
    }
    const ranges = input.zones.map((zone) => {
      const from = labelToIndex(zone.fromRow);
      const to = labelToIndex(zone.toRow);
      if (from < 0 || from >= input.rowCount || to < 0 || to >= input.rowCount || to < from) {
        throw validation('fromRow must be a row in this event.');
      }
      return { ...zone, from, to };
    });
    ranges.sort((a, b) => a.from - b.from);
    let cursor = 0;
    for (const range of ranges) {
      if (range.from !== cursor) {
        throw validation('Zones must cover every row exactly once.');
      }
      cursor = range.to + 1;
    }
    if (cursor !== input.rowCount) {
      throw validation('Zones must cover every row exactly once.');
    }

    return this.db.withWriteTransaction(async (client) => {
      const event = await client.query<{ id: string }>(
        `INSERT INTO events (name, venue, starts_at, drop_at, row_count, seats_per_row)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [input.name, input.venue, startsAt, dropAt, input.rowCount, input.seatsPerRow],
      );
      const eventId = event.rows[0].id;
      for (const range of ranges) {
        await client.query(
          `INSERT INTO zones (event_id, name, from_row, to_row, price_agorot)
           VALUES ($1, $2, $3, $4, $5)`,
          [eventId, range.name, range.from, range.to, range.priceAgorot],
        );
      }
      const seats = await client.query(
        `INSERT INTO seats (event_id, row_index, seat_number, zone_id, state)
         SELECT $1, r.idx, s.n, z.id, 'available'
         FROM generate_series(0, $2::int - 1) AS r(idx)
         JOIN zones z ON z.event_id = $1 AND r.idx BETWEEN z.from_row AND z.to_row
         CROSS JOIN generate_series(1, $3::int) AS s(n)`,
        [eventId, input.rowCount, input.seatsPerRow],
      );
      if (seats.rowCount !== input.rowCount * input.seatsPerRow) {
        throw validation('Zones must cover every row exactly once.');
      }
      return this.getOne(eventId, client);
    });
  }

  async list() {
    return this.db.withRead(async (client) => {
      const now = await client.query<{ server_now: Date }>('SELECT now() AS server_now');
      const serverNow = now.rows[0].server_now.toISOString();
      const rows = await client.query<{
        id: string;
        name: string;
        venue: string;
        starts_at: Date;
        drop_at: Date;
        row_count: number;
        seats_per_row: number;
        seat_count: string;
        on_sale: boolean;
      }>(
        `SELECT e.id, e.name, e.venue, e.starts_at, e.drop_at, e.row_count, e.seats_per_row,
                (e.row_count * e.seats_per_row)::int AS seat_count,
                e.drop_at <= now() AS on_sale
           FROM events e
          ORDER BY e.drop_at, e.name`,
      );
      return rows.rows.map((row) => ({
        id: row.id,
        name: row.name,
        venue: row.venue,
        startsAt: row.starts_at.toISOString(),
        dropAt: row.drop_at.toISOString(),
        serverNow,
        rowCount: row.row_count,
        seatsPerRow: row.seats_per_row,
        seatCount: Number(row.seat_count),
        onSale: row.on_sale,
      }));
    });
  }

  async get(eventId: string) {
    return this.db.withRead((client) => this.getOne(eventId, client));
  }

  async map(eventId: string, username: string | null) {
    return this.db.withRead(async (client) => {
      const event = await this.getOne(eventId, client);
      const seatRows = await client.query<{
        row_index: number;
        seat_number: number;
        zone_id: string;
        price_agorot: number;
        status: 'available' | 'held' | 'sold';
      }>(
        `SELECT s.row_index, s.seat_number, s.zone_id, z.price_agorot,
                CASE
                  WHEN s.state = 'sold' THEN 'sold'
                  WHEN s.state = 'held' AND h.status = 'active' AND h.expires_at > now() THEN 'held'
                  ELSE 'available'
                END AS status
           FROM seats s
           JOIN zones z ON z.id = s.zone_id
           LEFT JOIN holds h ON h.id = s.current_hold_id
          WHERE s.event_id = $1
          ORDER BY s.row_index, s.seat_number`,
        [eventId],
      );
      const clock = await client.query<{
        server_now: Date;
        ttl: number;
        max_seats: number;
      }>('SELECT now() AS server_now');
      let you = null;
      if (username) {
        const user = await client.query<{ id: string }>(
          'SELECT id FROM users WHERE username = $1',
          [username],
        );
        const holds = user.rowCount
          ? await this.liveHolds(client, user.rows[0].id, eventId)
          : [];
        const used = holds.reduce((sum, hold) => sum + hold.seatIds.length, 0);
        const bought = user.rowCount
          ? Number(
              (
                await client.query<{ n: string }>(
                  `SELECT count(*) AS n FROM order_seats os
                     JOIN orders o ON o.id = os.order_id
                    WHERE o.user_id = $1 AND o.event_id = $2`,
                  [user.rows[0].id, eventId],
                )
              ).rows[0].n,
            )
          : 0;
        const totalUsed = used + bought;
        you = {
          username,
          used: totalUsed,
          remaining: Math.max(0, this.db.env.maxSeatsPerUser - totalUsed),
          holds,
        };
      }
      return {
        event: {
          id: event.id,
          name: event.name,
          venue: event.venue,
          startsAt: event.startsAt,
          dropAt: event.dropAt,
          onSale: event.onSale,
          rowCount: event.rowCount,
          seatsPerRow: event.seatsPerRow,
        },
        serverNow: clock.rows[0].server_now.toISOString(),
        maxSeatsPerUser: this.db.env.maxSeatsPerUser,
        holdTtlSeconds: this.db.env.holdTtlSeconds,
        zones: event.zones,
        seats: seatRows.rows.map((seat) => ({
          id: `${indexToLabel(seat.row_index)}${seat.seat_number}`,
          row: indexToLabel(seat.row_index),
          number: seat.seat_number,
          zoneId: seat.zone_id,
          priceAgorot: Number(seat.price_agorot),
          status: seat.status,
        })),
        you,
      };
    });
  }

  private async liveHolds(
    client: { query: Database['readPool']['query'] },
    userId: string,
    eventId: string,
  ) {
    const holds = await client.query<{ id: string; expires_at: Date }>(
      `SELECT id, expires_at FROM holds
        WHERE user_id = $1 AND event_id = $2
          AND status = 'active' AND expires_at > now()
        ORDER BY expires_at`,
      [userId, eventId],
    );
    const result = [];
    for (const hold of holds.rows) {
      const seats = await client.query<{
        row_index: number;
        seat_number: number;
        price_agorot: number;
      }>(
        `SELECT hs.row_index, hs.seat_number, z.price_agorot
           FROM hold_seats hs
           JOIN seats s ON s.event_id = hs.event_id AND s.row_index = hs.row_index AND s.seat_number = hs.seat_number
           JOIN zones z ON z.id = s.zone_id
          WHERE hs.hold_id = $1
          ORDER BY hs.row_index, hs.seat_number`,
        [hold.id],
      );
      result.push({
        id: hold.id,
        expiresAt: hold.expires_at.toISOString(),
        seatIds: seats.rows.map((seat) => `${indexToLabel(seat.row_index)}${seat.seat_number}`),
        totalAgorot: seats.rows.reduce((sum, seat) => sum + Number(seat.price_agorot), 0),
      });
    }
    return result;
  }

  private async getOne(eventId: string, client: { query: Database['readPool']['query'] }) {
    const rows = await client.query<{
      id: string;
      name: string;
      venue: string;
      starts_at: Date;
      drop_at: Date;
      row_count: number;
      seats_per_row: number;
      server_now: Date;
      on_sale: boolean;
    }>(
      `SELECT id, name, venue, starts_at, drop_at, row_count, seats_per_row,
              now() AS server_now, drop_at <= now() AS on_sale
         FROM events WHERE id = $1`,
      [eventId],
    );
    if (rows.rowCount === 0) {
      throw new DomainError(404, 'NOT_FOUND', "We couldn't find that event.");
    }
    const event = rows.rows[0];
    const zones = await client.query<ZoneRow>(
      `SELECT id, name, from_row, to_row, price_agorot
         FROM zones WHERE event_id = $1 ORDER BY from_row`,
      [eventId],
    );
    return {
      id: event.id,
      name: event.name,
      venue: event.venue,
      startsAt: event.starts_at.toISOString(),
      dropAt: event.drop_at.toISOString(),
      serverNow: event.server_now.toISOString(),
      rowCount: event.row_count,
      seatsPerRow: event.seats_per_row,
      seatCount: event.row_count * event.seats_per_row,
      onSale: event.on_sale,
      zones: zones.rows.map((zone) => ({
        id: zone.id,
        name: zone.name,
        fromRow: indexToLabel(zone.from_row),
        toRow: indexToLabel(zone.to_row),
        priceAgorot: Number(zone.price_agorot),
      })),
    };
  }
}

function parseTime(value: string, field: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw validation(`${field} must be a timestamp.`);
  }
  return date;
}
