import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client, Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/http-exception.filter';
import { loadEnv } from '../src/config/env';
import { prepareDatabase } from '../src/db/migrate';
import { indexToLabel } from '../src/seats/seat-id';

const databaseUrl = process.env.DATABASE_URL!;
let app: INestApplication;
let pool: Pool;

beforeAll(async () => {
  await ensureTestDatabase(databaseUrl);
  await prepareDatabase(loadEnv());
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  pool = new Pool({ connectionString: databaseUrl });
});

beforeEach(async () => {
  const current = await pool.query<{ name: string }>('SELECT current_database() AS name');
  const name = current.rows[0].name;
  if (!name.endsWith('seatrush_test')) {
    throw new Error(`Refusing to truncate ${name}`);
  }
  await pool.query(
    `TRUNCATE order_seats, orders, promo_redemptions, hold_seats, holds,
             user_event_locks, seats, zones, events, users
     RESTART IDENTITY CASCADE`,
  );
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
});

describe('SeatRush', () => {
  it('answers health without reading seats', async () => {
    const response = await request(app.getHttpServer()).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('seeds Demo Night once', async () => {
    const env = { ...loadEnv(), seedDemo: true };
    await prepareDatabase(env);
    await prepareDatabase(env);
    const events = await pool.query<{ name: string; seats: string }>(
      `SELECT e.name, count(s.seat_number) AS seats
         FROM events e JOIN seats s ON s.event_id = e.id
        GROUP BY e.name`,
    );
    expect(events.rows).toEqual([{ name: 'Demo Night', seats: '96' }]);
  });

  it('rejects a bad identity and accepts a trimmed name', async () => {
    const event = await createShow();
    const missing = await request(app.getHttpServer())
      .post(`/events/${event.id}/holds`)
      .send({ seatIds: ['A1'] });
    expect(missing.status).toBe(401);
    expect(missing.body.message).toBe(
      'Tell us who you are with the X-Fan-Username header.',
    );
    const bad = await hold(event.id, 'has a space', ['A1']);
    expect(bad.status).toBe(400);
    expect(bad.body.message).toBe(
      'Use letters, numbers, underscores, or hyphens, up to 32 characters.',
    );
    const created = await hold(event.id, ' Ada ', ['A1']);
    expect(created.status).toBe(201);
    const mine = await request(app.getHttpServer())
      .get('/me/holds')
      .set('X-Fan-Username', 'ada');
    expect(mine.body).toHaveLength(1);
    const stranger = await request(app.getHttpServer())
      .get('/me/holds')
      .set('X-Fan-Username', 'nobody');
    expect(stranger.body).toEqual([]);
    const users = await pool.query("SELECT count(*) FROM users WHERE username = 'nobody'");
    expect(Number(users.rows[0].count)).toBe(0);
  });

  it('covers every row and refuses a drop that is not before the show', async () => {
    const gap = await request(app.getHttpServer())
      .post('/events')
      .send(showBody({ zones: [{ name: 'Stalls', fromRow: 'A', toRow: 'A', priceAgorot: 100 }] }));
    expect(gap.status).toBe(400);
    expect(gap.body.message).toBe('Zones must cover every row exactly once.');
    const late = await request(app.getHttpServer())
      .post('/events')
      .send(
        showBody({
          dropAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
          startsAt: new Date(Date.now() + 86_400_000).toISOString(),
        }),
      );
    expect(late.status).toBe(400);
    expect(late.body.message).toBe('The drop must be before the show starts.');
  });

  it('holds every requested seat or none of them', async () => {
    const event = await createShow();
    expect((await hold(event.id, 'ada', ['A1'])).status).toBe(201);
    const conflict = await hold(event.id, 'bea', ['A1', 'A2']);
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('SEAT_UNAVAILABLE');
    expect(conflict.body.message).toBe('Nothing was held. Someone just took A1.');
    expect(conflict.body.seatIds).toEqual(['A1']);
    const bea = await request(app.getHttpServer()).get('/me/holds').set('X-Fan-Username', 'bea');
    expect(bea.body).toEqual([]);
    const map = await mapOf(event.id);
    expect(statusOf(map, 'A1')).toBe('held');
    expect(statusOf(map, 'A2')).toBe('available');
  });

  it('enforces the per-show cap, including eight parallel requests', async () => {
    const event = await createShow();
    expect((await hold(event.id, 'ada', ['A1', 'A2', 'A3', 'A4'])).status).toBe(201);
    const fifth = await hold(event.id, 'ada', ['A5']);
    expect(fifth.status).toBe(409);
    expect(fifth.body.code).toBe('LIMIT_EXCEEDED');
    expect(fifth.body.message).toBe(
      'You can only hold 4 seats for this show, and you already have 4.',
    );
    expect(statusOf(await mapOf(event.id), 'A5')).toBe('available');

    const held = await request(app.getHttpServer()).get('/me/holds').set('X-Fan-Username', 'ada');
    expect((await release(held.body[0].id, 'ada')).status).toBe(200);
    expect((await hold(event.id, 'ada', ['A5'])).status).toBe(201);

    const bought = await request(app.getHttpServer()).get('/me/holds').set('X-Fan-Username', 'ada');
    expect((await checkout(bought.body[0].id, 'ada')).status).toBe(200);
    const tooMany = await hold(event.id, 'ada', ['A1', 'A2', 'A3', 'A4']);
    expect(tooMany.body.code).toBe('LIMIT_EXCEEDED');
    expect(tooMany.body.message).toBe(
      'You can only hold 4 seats for this show, and you already have 1.',
    );
    expect((await hold(event.id, 'ada', ['A1', 'A2', 'A3'])).status).toBe(201);

    const parallel = await createShow();
    const seats = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8'];
    const results = await Promise.all(seats.map((seat) => hold(parallel.id, 'ada', [seat])));
    expect(results.filter((result) => result.status === 201)).toHaveLength(4);
    const limited = results.filter((result) => result.body.code === 'LIMIT_EXCEEDED');
    expect(limited).toHaveLength(4);
  });

  it('lets exactly one of forty fans hold B7, three times', async () => {
    for (let round = 0; round < 3; round++) {
      const event = await createShow();
      const fans = Array.from({ length: 40 }, (_, index) => `fan${index + 1}`);
      const results = await Promise.all(fans.map((fan) => hold(event.id, fan, ['B7'])));
      expect(results.filter((result) => result.status === 201)).toHaveLength(1);
      const losses = results.filter((result) => result.status === 409);
      expect(losses).toHaveLength(39);
      for (const loss of losses) expect(loss.body.message).toContain('B7');
      const holds = await pool.query('SELECT count(*) FROM holds WHERE event_id = $1', [event.id]);
      const lines = await pool.query('SELECT count(*) FROM hold_seats WHERE event_id = $1', [
        event.id,
      ]);
      expect(Number(holds.rows[0].count)).toBe(1);
      expect(Number(lines.rows[0].count)).toBe(1);
      const doubled = await pool.query(
        `SELECT hs.event_id, hs.row_index, hs.seat_number, count(*)
           FROM hold_seats hs JOIN holds h ON h.id = hs.hold_id
          WHERE h.status = 'active' AND h.expires_at > now()
          GROUP BY 1, 2, 3 HAVING count(*) > 1`,
      );
      expect(doubled.rows).toEqual([]);
    }
  });

  it('keeps a future drop closed, expires a hold on the clock, and releases it', async () => {
    const closed = await createShow({
      dropAt: new Date(Date.now() + 86_400_000).toISOString(),
      startsAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    });
    expect((await mapOf(closed.id)).status).toBe(200);
    const early = await hold(closed.id, 'ada', ['A1']);
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('NOT_ON_SALE');
    expect(early.body.message).toMatch(/^Tickets go on sale at /);

    const event = await createShow();
    const created = await hold(event.id, 'ada', ['A1']);
    await pool.query(`UPDATE holds SET expires_at = now() - interval '1 second' WHERE id = $1`, [
      created.body.id,
    ]);
    const expired = await checkout(created.body.id, 'ada');
    expect(expired.status).toBe(409);
    expect(expired.body.message).toBe('Your hold has expired. These seats are back on sale.');
    expect(statusOf(await mapOf(event.id), 'A1')).toBe('available');
    expect((await hold(event.id, 'bea', ['A1'])).status).toBe(201);

    const aged = await hold(event.id, 'ada', ['A2']);
    await pool.query(`UPDATE holds SET expires_at = now() - interval '6 seconds' WHERE id = $1`, [
      aged.body.id,
    ]);
    expect(statusOf(await mapOf(event.id), 'A2')).toBe('available');

    const live = await hold(event.id, 'ada', ['B1', 'B2']);
    expect((await release(live.body.id, 'bea')).status).toBe(403);
    expect((await release(live.body.id, 'bea')).body.message).toBe(
      'This hold belongs to another fan.',
    );
    expect((await release(live.body.id, 'ada')).status).toBe(200);
    expect(statusOf(await mapOf(event.id), 'B1')).toBe('available');
    expect((await hold(event.id, 'ada', ['B1', 'B2', 'B3', 'B4'])).status).toBe(201);
    expect((await release(live.body.id, 'ada')).status).toBe(200);
  });

  it('returns B2-B3 for the worked room and writes nothing when no block exists', async () => {
    const event = await createShow({ rows: 3, seats: 8, price: 10000 });
    const buyers = [
      ['ada', ['A1', 'A2', 'A3', 'A4']],
      ['bea', ['A5', 'A6', 'A7', 'A8']],
      ['cy', ['B4', 'B5']],
    ] as const;
    for (const [fan, seats] of buyers) {
      const created = await hold(event.id, fan, [...seats]);
      expect(created.status).toBe(201);
      expect((await checkout(created.body.id, fan)).status).toBe(200);
    }
    const best = await request(app.getHttpServer())
      .post(`/events/${event.id}/holds`)
      .set('X-Fan-Username', 'dee')
      .send({ bestAvailable: { count: 2 } });
    expect(best.status).toBe(201);
    expect(best.body.seatIds).toEqual(['B2', 'B3']);
    expect(statusOf(await mapOf(event.id), 'B2')).toBe('held');
    expect(statusOf(await mapOf(event.id), 'B3')).toBe('held');

    const broken = await createShow({ rows: 1, seats: 8 });
    for (const seat of ['A1', 'A3', 'A5', 'A7']) {
      const created = await hold(broken.id, 'ada', [seat]);
      expect((await checkout(created.body.id, 'ada')).status).toBe(200);
    }
    const before = await pool.query('SELECT count(*) FROM holds');
    const none = await request(app.getHttpServer())
      .post(`/events/${broken.id}/holds`)
      .set('X-Fan-Username', 'bea')
      .send({ bestAvailable: { count: 2 } });
    expect(none.status).toBe(409);
    expect(none.body.code).toBe('NO_BLOCK');
    expect(none.body.message).toBe('No 2 seats together are free in that price range.');
    const after = await pool.query('SELECT count(*) FROM holds');
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });

  it('sells a hold once and replays the same order after the hold clock passes', async () => {
    const event = await createShow({ price: 15000 });
    const created = await hold(event.id, 'ada', ['A1', 'A2']);
    const first = await checkout(created.body.id, 'ada');
    expect(first.status).toBe(200);
    expect(first.body.totalAgorot).toBe(30000);
    expect(first.body.discountAgorot).toBe(0);
    expect(first.body.alreadyExisted).toBe(false);
    expect(first.body.seatIds).toEqual(['A1', 'A2']);
    const second = await checkout(created.body.id, 'ada');
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.alreadyExisted).toBe(true);
    expect((await checkout(created.body.id, 'bea')).status).toBe(403);
    const again = await hold(event.id, 'bea', ['A1', 'A2']);
    expect(again.status).toBe(409);
    expect(again.body.message).toBe('Nothing was held. A1 and A2 are already sold.');
    await pool.query(`UPDATE holds SET expires_at = now() - interval '1 second' WHERE id = $1`, [
      created.body.id,
    ]);
    const replay = await checkout(created.body.id, 'ada');
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(first.body.id);
    const promo = await checkout(created.body.id, 'ada', 'SAVE10');
    expect(promo.status).toBe(200);
    expect(promo.body.id).toBe(first.body.id);
    expect(promo.body.discountAgorot).toBe(0);
    expect(promo.body.totalAgorot).toBe(30000);
    expect(promo.body.alreadyExisted).toBe(true);
  });

  it('applies SAVE10 and WELCOME20, and leaves the hold when the code is bad', async () => {
    const event = await createShow({ price: 34935, seats: 4 });
    const save = await hold(event.id, 'ada', ['A1']);
    const saved = await checkout(save.body.id, 'ada', 'save10');
    expect(saved.status).toBe(200);
    expect(saved.body.subtotalAgorot).toBe(34935);
    expect(saved.body.discountAgorot).toBe(3494);
    expect(saved.body.totalAgorot).toBe(31441);
    expect(saved.body.promoCode).toBe('SAVE10');

    const welcome = await hold(event.id, 'ada', ['A2']);
    const firstWelcome = await checkout(welcome.body.id, 'ada', 'WELCOME20');
    expect(firstWelcome.status).toBe(200);
    expect(firstWelcome.body.discountAgorot).toBe(2000);
    expect(firstWelcome.body.totalAgorot).toBe(32935);

    const other = await createShow({ price: 34935, seats: 2 });
    const again = await hold(other.id, 'ada', ['A1']);
    const reused = await checkout(again.body.id, 'ada', 'WELCOME20');
    expect(reused.status).toBe(409);
    expect(reused.body.code).toBe('PROMO_USED');
    expect(reused.body.message).toBe('WELCOME20 can only be used once.');
    expect(statusOf(await mapOf(other.id), 'A1')).toBe('held');

    const badHold = await hold(event.id, 'bea', ['A3']);
    const bad = await checkout(badHold.body.id, 'bea', 'NOPE');
    expect(bad.status).toBe(409);
    expect(bad.body.code).toBe('PROMO_INVALID');
    expect(bad.body.message).toBe("That coupon code isn't valid.");
    expect(statusOf(await mapOf(event.id), 'A3')).toBe('held');
    expect((await checkout(badHold.body.id, 'bea', '   ')).body.discountAgorot).toBe(0);
  });

  it('applies the lone-seat rule only when OneSeatMode is on', async () => {
    const event = await createShow({ rows: 3, seats: 8, price: 10000 });
    const buyers = [
      ['ada', ['A1', 'A2', 'A3', 'A4']],
      ['bea', ['A5', 'A6', 'A7', 'A8']],
      ['cy', ['B4', 'B5']],
    ] as const;
    for (const [fan, seats] of buyers) {
      const created = await hold(event.id, fan, [...seats]);
      expect((await checkout(created.body.id, fan)).status).toBe(200);
    }
    const blocked = await request(app.getHttpServer())
      .post(`/events/${event.id}/holds`)
      .set('X-Fan-Username', 'dee')
      .send({ seatIds: ['B2', 'B3'], oneSeatMode: true });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('LONE_SEAT');
    expect(blocked.body.message).toBe(
      'That choice would leave a single empty seat stuck on its own. Pick different seats.',
    );
    expect(statusOf(await mapOf(event.id), 'B2')).toBe('available');

    const best = await request(app.getHttpServer())
      .post(`/events/${event.id}/holds`)
      .set('X-Fan-Username', 'dee')
      .send({ bestAvailable: { count: 2 }, oneSeatMode: true });
    expect(best.status).toBe(201);
    expect(best.body.seatIds).toEqual(['C4', 'C5']);

    const quiet = await createShow({ seats: 8 });
    const sold = await hold(quiet.id, 'ada', ['A2']);
    expect((await checkout(sold.body.id, 'ada')).status).toBe(200);
    const later = await request(app.getHttpServer())
      .post(`/events/${quiet.id}/holds`)
      .set('X-Fan-Username', 'bea')
      .send({ seatIds: ['A8'], oneSeatMode: true });
    expect(later.status).toBe(201);
    expect(later.body.seatIds).toEqual(['A8']);
  });

  it('deletes a fan and returns their seats to sale', async () => {
    const event = await createShow();
    const created = await hold(event.id, 'ada', ['A1']);
    expect((await checkout(created.body.id, 'ada')).status).toBe(200);
    const live = await hold(event.id, 'ada', ['A2']);
    expect(live.status).toBe(201);
    const listed = await request(app.getHttpServer()).get('/admin/users');
    expect(listed.status).toBe(200);
    expect(listed.body.map((fan: { username: string }) => fan.username)).toContain('ada');

    const removed = await request(app.getHttpServer()).delete('/admin/users/ada');
    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ username: 'ada', deleted: true });
    expect(statusOf(await mapOf(event.id), 'A1')).toBe('available');
    expect(statusOf(await mapOf(event.id), 'A2')).toBe('available');
    const orders = await pool.query('SELECT count(*) FROM orders');
    const users = await pool.query(`SELECT count(*) FROM users WHERE username = 'ada'`);
    expect(orders.rows[0].count).toBe('0');
    expect(users.rows[0].count).toBe('0');
    expect((await request(app.getHttpServer()).delete('/admin/users/ada')).status).toBe(404);
  });
});

function showBody(overrides: Record<string, unknown> = {}) {
  const rows = Number(overrides.rows ?? 2);
  const seats = Number(overrides.seats ?? 12);
  return {
    name: 'Show',
    venue: 'Hall',
    startsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    dropAt: new Date(Date.now() - 3_600_000).toISOString(),
    rowCount: rows,
    seatsPerRow: seats,
    zones: [
      {
        name: 'Stalls',
        fromRow: 'A',
        toRow: indexToLabel(rows - 1),
        priceAgorot: 15000,
      },
    ],
    ...overrides,
    ...(overrides.price
      ? {
          zones: [
            {
              name: 'Stalls',
              fromRow: 'A',
              toRow: indexToLabel(rows - 1),
              priceAgorot: overrides.price,
            },
          ],
        }
      : {}),
  };
}

async function createShow(overrides: Record<string, unknown> = {}) {
  const response = await request(app.getHttpServer()).post('/events').send(showBody(overrides));
  expect(response.status).toBe(201);
  expect(response.body.seatCount).toBe(
    Number(overrides.rows ?? 2) * Number(overrides.seats ?? 12),
  );
  return response.body as { id: string };
}

function hold(eventId: string, fan: string, seatIds: string[]) {
  return request(app.getHttpServer())
    .post(`/events/${eventId}/holds`)
    .set('X-Fan-Username', fan)
    .send({ seatIds });
}

function release(holdId: string, fan: string) {
  return request(app.getHttpServer())
    .post(`/holds/${holdId}/release`)
    .set('X-Fan-Username', fan);
}

function checkout(holdId: string, fan: string, promoCode?: string) {
  return request(app.getHttpServer())
    .post(`/holds/${holdId}/checkout`)
    .set('X-Fan-Username', fan)
    .send(promoCode ? { promoCode } : {});
}

function mapOf(eventId: string) {
  return request(app.getHttpServer()).get(`/events/${eventId}/map`);
}

function statusOf(
  response: { body: { seats: { id: string; status: string }[] } },
  seatId: string,
) {
  return response.body.seats.find((seat) => seat.id === seatId)?.status;
}

async function ensureTestDatabase(url: string): Promise<void> {
  const admin = new URL(url);
  const database = admin.pathname.replace(/^\//, '');
  admin.pathname = '/seatrush';
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
    if (existing.rowCount === 0) {
      await client.query(`CREATE DATABASE ${quoteIdent(database)}`);
    }
  } finally {
    await client.end();
  }
}

function quoteIdent(value: string): string {
  if (!/^[a-z0-9_]+$/.test(value)) throw new Error('Unexpected database name');
  return value;
}
