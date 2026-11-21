import { readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';
import { Env } from '../config/env';

const MIGRATION = '001_init.sql';

export async function prepareDatabase(env: Env): Promise<void> {
  const client = new Client({ connectionString: env.databaseUrl });
  await connectWithRetry(client);
  try {
    await client.query('SELECT pg_advisory_lock(814200)');
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const applied = await client.query(
      'SELECT 1 FROM schema_migrations WHERE filename = $1',
      [MIGRATION],
    );
    if (applied.rowCount === 0) {
      const sql = readFileSync(join(__dirname, 'sql', MIGRATION), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [
          MIGRATION,
        ]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    if (env.seedDemo) await seedDemo(client);
  } finally {
    await client.query('SELECT pg_advisory_unlock(814200)').catch(() => undefined);
    await client.end();
  }
}

async function seedDemo(client: Client): Promise<void> {
  const existing = await client.query('SELECT count(*)::int AS n FROM events');
  if (Number(existing.rows[0].n) > 0) return;
  await client.query('BEGIN');
  try {
    const event = await client.query<{ id: string }>(
      `INSERT INTO events (name, venue, starts_at, drop_at, row_count, seats_per_row)
       VALUES ('Demo Night', 'The Rialto', now() + interval '30 days', now() - interval '1 hour', 8, 12)
       RETURNING id`,
    );
    const eventId = event.rows[0].id;
    await client.query(
      `INSERT INTO zones (event_id, name, from_row, to_row, price_agorot) VALUES
        ($1, 'Stalls', 0, 2, 15000),
        ($1, 'Circle', 3, 5, 10000),
        ($1, 'Balcony', 6, 7, 6000)`,
      [eventId],
    );
    const inserted = await client.query(
      `INSERT INTO seats (event_id, row_index, seat_number, zone_id, state)
       SELECT $1, r.idx, s.n, z.id, 'available'
       FROM generate_series(0, 7) AS r(idx)
       JOIN zones z ON z.event_id = $1 AND r.idx BETWEEN z.from_row AND z.to_row
       CROSS JOIN generate_series(1, 12) AS s(n)`,
      [eventId],
    );
    if (inserted.rowCount !== 96) {
      throw new Error('Demo seed did not create 96 seats');
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function connectWithRetry(client: Client): Promise<void> {
  let last: unknown;
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      await client.connect();
      return;
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw last;
}
