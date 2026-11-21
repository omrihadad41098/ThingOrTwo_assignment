import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, DatabaseError } from 'pg';
import { Env } from '../config/env';
import { DomainError, busy } from '../common/errors';

@Injectable()
export class Database implements OnModuleDestroy {
  private readonly logger = new Logger(Database.name);
  readonly readPool: Pool;
  readonly writePool: Pool;

  constructor(readonly env: Env) {
    this.writePool = new Pool({
      connectionString: env.databaseUrl,
      max: env.writePoolMax,
      connectionTimeoutMillis: 2000,
      idleTimeoutMillis: 10000,
    });
    this.readPool = new Pool({
      connectionString: env.databaseUrl,
      max: env.readPoolMax,
      connectionTimeoutMillis: 2000,
      idleTimeoutMillis: 10000,
    });
    this.writePool.on('error', (error) => this.logger.error(error.message));
    this.readPool.on('error', (error) => this.logger.error(error.message));
  }

  async onModuleDestroy(): Promise<void> {
    await this.writePool.end();
    await this.readPool.end();
  }

  async withRead<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    let client: PoolClient;
    try {
      client = await this.readPool.connect();
    } catch (error) {
      throw mapPoolError(error);
    }
    try {
      await client.query('BEGIN READ ONLY');
      await client.query("SET LOCAL statement_timeout = '3s'");
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async withWriteTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 2; attempt++) {
      let client: PoolClient;
      try {
        client = await this.writePool.connect();
      } catch (error) {
        throw mapPoolError(error);
      }
      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout = '2s'");
        await client.query("SET LOCAL statement_timeout = '5s'");
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        lastError = error;
        if (error instanceof DomainError) throw error;
        const code = pgCode(error);
        if (code === '40P01' && attempt === 1) continue;
        if (code === '40P01' || code === '55P03' || code === '57014') throw busy();
        throw error;
      } finally {
        client.release();
      }
    }
    throw lastError;
  }
}

function pgCode(error: unknown): string | undefined {
  if (error instanceof DatabaseError) return error.code;
  if (typeof error === 'object' && error && 'code' in error) {
    return String((error as { code: unknown }).code);
  }
  return undefined;
}

function mapPoolError(error: unknown): Error {
  const message = error instanceof Error ? error.message : '';
  if (/timeout/i.test(message) || /remaining connection slots/i.test(message)) {
    return busy();
  }
  return error instanceof Error ? error : new Error(String(error));
}

export function isLockNotAvailable(error: unknown): boolean {
  return pgCode(error) === '55P03';
}
