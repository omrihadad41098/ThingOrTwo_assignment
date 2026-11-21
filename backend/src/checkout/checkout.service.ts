import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { DomainError, notFound } from '../common/errors';
import { Database } from '../db/database';
import { indexToLabel } from '../seats/seat-id';
import { OrderView, readOrderByHold } from './order-view';
import { quotePromo } from './pricing';

export const checkoutBodySchema = z.object({
  promoCode: z.string().optional(),
});

@Injectable()
export class CheckoutService {
  constructor(private readonly db: Database) {}

  async checkout(holdId: string, username: string, promoCode: string | null): Promise<OrderView> {
    const peek = await this.db.withRead(async (client) => {
      const result = await client.query<{ event_id: string }>(
        'SELECT event_id FROM holds WHERE id = $1',
        [holdId],
      );
      if (result.rowCount === 0) throw notFound("We couldn't find that hold.");
      return result.rows[0];
    });
    try {
      return await this.db.withWriteTransaction((client) =>
        this.purchase(client, holdId, username, peek.event_id, promoCode),
      );
    } catch (error) {
      if (isPromoUniqueViolation(error)) {
        throw new DomainError(409, 'PROMO_USED', 'WELCOME20 can only be used once.');
      }
      if (!isHoldUniqueViolation(error)) throw error;
      const order = await this.db.withRead((client) => readOrderByHold(client, holdId, true));
      if (!order) throw error;
      return order;
    }
  }

  private async purchase(
    client: PoolClient,
    holdId: string,
    username: string,
    eventId: string,
    promoCode: string | null,
  ): Promise<OrderView> {
    const user = await client.query<{ id: string }>(
      'SELECT id FROM users WHERE username = $1',
      [username],
    );
    if (user.rowCount === 0) {
      throw new DomainError(403, 'FORBIDDEN', 'This hold belongs to another fan.');
    }
    const userId = user.rows[0].id;
    const lock = await client.query(
      `SELECT 1 FROM user_event_locks WHERE user_id = $1 AND event_id = $2 FOR UPDATE`,
      [userId, eventId],
    );
    if (lock.rowCount === 0) {
      throw new DomainError(403, 'FORBIDDEN', 'This hold belongs to another fan.');
    }
    const hold = await client.query<{
      id: string;
      user_id: string;
      status: string;
      expired: boolean;
    }>(
      `SELECT id, user_id, status, expires_at <= now() AS expired
         FROM holds WHERE id = $1 FOR UPDATE`,
      [holdId],
    );
    if (hold.rowCount === 0) throw notFound("We couldn't find that hold.");
    const row = hold.rows[0];
    if (row.user_id !== userId) {
      throw new DomainError(403, 'FORBIDDEN', 'This hold belongs to another fan.');
    }
    const existing = await readOrderByHold(client, holdId, true);
    if (existing) return existing;
    if (row.status === 'released') {
      throw new DomainError(409, 'HOLD_CLOSED', 'This hold was released.');
    }
    if (row.status === 'converted') {
      throw new DomainError(409, 'HOLD_CLOSED', 'These seats are already bought.');
    }
    if (row.expired) {
      throw new DomainError(
        409,
        'HOLD_EXPIRED',
        'Your hold has expired. These seats are back on sale.',
      );
    }
    const seats = await client.query<{
      row_index: number;
      seat_number: number;
      state: string;
      current_hold_id: string | null;
      price_agorot: number;
    }>(
      `SELECT s.row_index, s.seat_number, s.state, s.current_hold_id, z.price_agorot
         FROM hold_seats hs
         JOIN seats s
           ON s.event_id = hs.event_id
          AND s.row_index = hs.row_index
          AND s.seat_number = hs.seat_number
         JOIN zones z ON z.id = s.zone_id
        WHERE hs.hold_id = $1
        ORDER BY s.row_index, s.seat_number
        FOR UPDATE OF s`,
      [holdId],
    );
    if (seats.rowCount === 0) {
      throw new DomainError(409, 'HOLD_CLOSED', 'This hold was released.');
    }
    for (const seat of seats.rows) {
      if (seat.state !== 'held' || seat.current_hold_id !== holdId) {
        throw new DomainError(
          409,
          'HOLD_EXPIRED',
          'Your hold has expired. These seats are back on sale.',
        );
      }
    }
    const subtotal = seats.rows.reduce((sum, seat) => sum + Number(seat.price_agorot), 0);
    const priced = quotePromo(subtotal, promoCode);
    if (priced.unknown) {
      throw new DomainError(409, 'PROMO_INVALID', "That coupon code isn't valid.");
    }
    if (priced.promoCode === 'WELCOME20') {
      const used = await client.query(
        `SELECT 1 FROM promo_redemptions WHERE code = 'WELCOME20' AND user_id = $1`,
        [userId],
      );
      if ((used.rowCount ?? 0) > 0) {
        throw new DomainError(409, 'PROMO_USED', 'WELCOME20 can only be used once.');
      }
    }
    const inserted = await client.query<{ id: string; created_at: Date }>(
      `INSERT INTO orders
         (hold_id, event_id, user_id, subtotal_agorot, discount_agorot, total_agorot, promo_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, created_at`,
      [
        holdId,
        eventId,
        userId,
        subtotal,
        priced.discountAgorot,
        priced.totalAgorot,
        priced.promoCode,
      ],
    );
    if (priced.promoCode === 'WELCOME20') {
      await client.query(
        `INSERT INTO promo_redemptions (code, user_id, order_id) VALUES ('WELCOME20', $1, $2)`,
        [userId, inserted.rows[0].id],
      );
    }
    const order = inserted.rows[0];
    for (const seat of seats.rows) {
      await client.query(
        `INSERT INTO order_seats (order_id, event_id, row_index, seat_number, price_agorot)
         VALUES ($1, $2, $3, $4, $5)`,
        [order.id, eventId, seat.row_index, seat.seat_number, Number(seat.price_agorot)],
      );
      const sold = await client.query(
        `UPDATE seats
            SET state = 'sold', current_hold_id = NULL
          WHERE event_id = $1 AND row_index = $2 AND seat_number = $3
            AND current_hold_id = $4 AND state = 'held'`,
        [eventId, seat.row_index, seat.seat_number, holdId],
      );
      if (sold.rowCount !== 1) {
        throw new DomainError(
          409,
          'HOLD_EXPIRED',
          'Your hold has expired. These seats are back on sale.',
        );
      }
    }
    await client.query(`UPDATE holds SET status = 'converted' WHERE id = $1`, [holdId]);
    const event = await client.query<{ name: string }>('SELECT name FROM events WHERE id = $1', [
      eventId,
    ]);
    return {
      id: order.id,
      holdId,
      eventId,
      eventName: event.rows[0].name,
      seatIds: seats.rows.map((seat) => `${indexToLabel(seat.row_index)}${seat.seat_number}`),
      subtotalAgorot: subtotal,
      discountAgorot: priced.discountAgorot,
      totalAgorot: priced.totalAgorot,
      promoCode: priced.promoCode,
      createdAt: order.created_at.toISOString(),
      alreadyExisted: false,
    };
  }
}

function isPromoUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error == null) return false;
  const candidate = error as { code?: string; constraint?: string };
  return candidate.code === '23505' && candidate.constraint === 'promo_redemptions_pkey';
}

function isHoldUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error == null) return false;
  const candidate = error as { code?: string; constraint?: string };
  return candidate.code === '23505' && candidate.constraint === 'orders_hold_id_key';
}
