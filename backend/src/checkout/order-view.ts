import { PoolClient } from 'pg';
import { indexToLabel } from '../seats/seat-id';

export type OrderView = {
  id: string;
  holdId: string;
  eventId: string;
  eventName: string;
  seatIds: string[];
  subtotalAgorot: number;
  discountAgorot: number;
  totalAgorot: number;
  promoCode: string | null;
  createdAt: string;
  alreadyExisted: boolean;
};

type OrderRow = {
  id: string;
  hold_id: string;
  event_id: string;
  event_name: string;
  subtotal_agorot: number;
  discount_agorot: number;
  total_agorot: number;
  promo_code: string | null;
  created_at: Date;
};

export async function readOrderByHold(
  client: PoolClient,
  holdId: string,
  alreadyExisted: boolean,
): Promise<OrderView | null> {
  const result = await client.query<OrderRow>(ORDER_SQL + ' WHERE o.hold_id = $1', [holdId]);
  const row = result.rows[0];
  if (!row) return null;
  return toView(client, row, alreadyExisted);
}

export async function readOrdersForUser(
  client: PoolClient,
  userId: string,
): Promise<OrderView[]> {
  const result = await client.query<OrderRow>(
    ORDER_SQL + ' WHERE o.user_id = $1 ORDER BY o.created_at DESC',
    [userId],
  );
  const orders: OrderView[] = [];
  for (const row of result.rows) {
    orders.push(await toView(client, row, false));
  }
  return orders;
}

const ORDER_SQL = `
  SELECT o.id, o.hold_id, o.event_id, e.name AS event_name,
         o.subtotal_agorot, o.discount_agorot, o.total_agorot,
         o.promo_code, o.created_at
    FROM orders o
    JOIN events e ON e.id = o.event_id
`;

async function toView(
  client: PoolClient,
  row: OrderRow,
  alreadyExisted: boolean,
): Promise<OrderView> {
  const seats = await client.query<{ row_index: number; seat_number: number }>(
    `SELECT row_index, seat_number FROM order_seats
      WHERE order_id = $1
      ORDER BY row_index, seat_number`,
    [row.id],
  );
  return {
    id: row.id,
    holdId: row.hold_id,
    eventId: row.event_id,
    eventName: row.event_name,
    seatIds: seats.rows.map((seat) => `${indexToLabel(seat.row_index)}${seat.seat_number}`),
    subtotalAgorot: Number(row.subtotal_agorot),
    discountAgorot: Number(row.discount_agorot),
    totalAgorot: Number(row.total_agorot),
    promoCode: row.promo_code,
    createdAt: row.created_at.toISOString(),
    alreadyExisted,
  };
}
