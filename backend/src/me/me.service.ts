import { Injectable } from '@nestjs/common';
import { Database } from '../db/database';
import { readOrdersForUser } from '../checkout/order-view';
import { indexToLabel } from '../seats/seat-id';

@Injectable()
export class MeService {
  constructor(private readonly db: Database) {}

  holds(username: string) {
    return this.db.withRead(async (client) => {
      const now = await client.query<{ server_now: Date }>('SELECT now() AS server_now');
      const user = await client.query<{ id: string }>(
        'SELECT id FROM users WHERE username = $1',
        [username],
      );
      if (user.rowCount === 0) return [];
      const holds = await client.query<{
        id: string;
        event_id: string;
        event_name: string;
        expires_at: Date;
      }>(
        `SELECT h.id, h.event_id, e.name AS event_name, h.expires_at
           FROM holds h
           JOIN events e ON e.id = h.event_id
          WHERE h.user_id = $1 AND h.status = 'active' AND h.expires_at > now()
          ORDER BY h.expires_at`,
        [user.rows[0].id],
      );
      const items = [];
      for (const hold of holds.rows) {
        const seats = await client.query<{
          row_index: number;
          seat_number: number;
          price_agorot: number;
        }>(
          `SELECT hs.row_index, hs.seat_number, z.price_agorot
             FROM hold_seats hs
             JOIN seats s
               ON s.event_id = hs.event_id
              AND s.row_index = hs.row_index
              AND s.seat_number = hs.seat_number
             JOIN zones z ON z.id = s.zone_id
            WHERE hs.hold_id = $1
            ORDER BY hs.row_index, hs.seat_number`,
          [hold.id],
        );
        items.push({
          id: hold.id,
          eventId: hold.event_id,
          eventName: hold.event_name,
          serverNow: now.rows[0].server_now.toISOString(),
          expiresAt: hold.expires_at.toISOString(),
          seatIds: seats.rows.map(
            (seat) => `${indexToLabel(seat.row_index)}${seat.seat_number}`,
          ),
          totalAgorot: seats.rows.reduce((sum, seat) => sum + Number(seat.price_agorot), 0),
        });
      }
      return items;
    });
  }

  orders(username: string) {
    return this.db.withRead(async (client) => {
      const user = await client.query<{ id: string }>(
        'SELECT id FROM users WHERE username = $1',
        [username],
      );
      if (user.rowCount === 0) return [];
      return readOrdersForUser(client, user.rows[0].id);
    });
  }
}
