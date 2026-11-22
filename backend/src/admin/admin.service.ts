import { Injectable } from '@nestjs/common';
import { notFound } from '../common/errors';
import { normalizeUsername } from '../common/fan';
import { requireUuid } from '../common/ids';
import { Database } from '../db/database';

export type FanAccount = {
  username: string;
  createdAt: string;
  holdCount: number;
  orderCount: number;
};

@Injectable()
export class AdminService {
  constructor(private readonly db: Database) {}

  listUsers(): Promise<FanAccount[]> {
    return this.db.withRead(async (client) => {
      const result = await client.query<{
        username: string;
        created_at: Date;
        hold_count: string;
        order_count: string;
      }>(
        `SELECT u.username,
                u.created_at,
                (SELECT count(*) FROM holds h WHERE h.user_id = u.id) AS hold_count,
                (SELECT count(*) FROM orders o WHERE o.user_id = u.id) AS order_count
           FROM users u
          ORDER BY u.created_at DESC, u.username`,
      );
      return result.rows.map((row) => ({
        username: row.username,
        createdAt: row.created_at.toISOString(),
        holdCount: Number(row.hold_count),
        orderCount: Number(row.order_count),
      }));
    });
  }

  deleteUser(rawUsername: string): Promise<{ username: string; deleted: true }> {
    const username = normalizeUsername(rawUsername);
    if (!username) throw notFound("We couldn't find that fan.");
    return this.db.withWriteTransaction(async (client) => {
      const user = await client.query<{ id: string }>(
        `SELECT id FROM users WHERE username = $1 FOR UPDATE`,
        [username],
      );
      if (user.rowCount === 0) throw notFound("We couldn't find that fan.");
      const userId = user.rows[0].id;

      await client.query(
        `UPDATE seats
            SET state = 'available', current_hold_id = NULL
          WHERE current_hold_id IN (SELECT id FROM holds WHERE user_id = $1)`,
        [userId],
      );
      await client.query(
        `UPDATE seats s
            SET state = 'available', current_hold_id = NULL
           FROM order_seats os
           JOIN orders o ON o.id = os.order_id
          WHERE o.user_id = $1
            AND s.event_id = os.event_id
            AND s.row_index = os.row_index
            AND s.seat_number = os.seat_number
            AND s.state = 'sold'`,
        [userId],
      );
      await client.query(`DELETE FROM promo_redemptions WHERE user_id = $1`, [userId]);
      await client.query(
        `DELETE FROM order_seats WHERE order_id IN (SELECT id FROM orders WHERE user_id = $1)`,
        [userId],
      );
      await client.query(`DELETE FROM orders WHERE user_id = $1`, [userId]);
      await client.query(
        `DELETE FROM hold_seats WHERE hold_id IN (SELECT id FROM holds WHERE user_id = $1)`,
        [userId],
      );
      await client.query(`DELETE FROM holds WHERE user_id = $1`, [userId]);
      await client.query(`DELETE FROM user_event_locks WHERE user_id = $1`, [userId]);
      await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
      return { username, deleted: true as const };
    });
  }

  deleteEvent(rawId: string): Promise<{ id: string; name: string; deleted: true }> {
    const id = requireUuid(rawId, 'event');
    return this.db.withWriteTransaction(async (client) => {
      const event = await client.query<{ id: string; name: string }>(
        `SELECT id, name FROM events WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (event.rowCount === 0) throw notFound("We couldn't find that event.");
      const name = event.rows[0].name;

      await client.query(`UPDATE seats SET current_hold_id = NULL WHERE event_id = $1`, [id]);
      await client.query(
        `DELETE FROM promo_redemptions
          WHERE order_id IN (SELECT id FROM orders WHERE event_id = $1)`,
        [id],
      );
      await client.query(`DELETE FROM order_seats WHERE event_id = $1`, [id]);
      await client.query(`DELETE FROM orders WHERE event_id = $1`, [id]);
      await client.query(`DELETE FROM hold_seats WHERE event_id = $1`, [id]);
      await client.query(`DELETE FROM holds WHERE event_id = $1`, [id]);
      await client.query(`DELETE FROM seats WHERE event_id = $1`, [id]);
      await client.query(`DELETE FROM user_event_locks WHERE event_id = $1`, [id]);
      await client.query(`DELETE FROM zones WHERE event_id = $1`, [id]);
      await client.query(`DELETE FROM events WHERE id = $1`, [id]);
      return { id, name, deleted: true as const };
    });
  }
}
