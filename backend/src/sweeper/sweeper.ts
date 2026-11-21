import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Database } from '../db/database';

@Injectable()
export class Sweeper implements OnModuleDestroy {
  private readonly logger = new Logger(Sweeper.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly db: Database) {}

  start(): void {
    if (!this.db.env.sweeperEnabled) return;
    this.timer = setInterval(() => {
      void this.sweep();
    }, 10_000);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(): Promise<void> {
    try {
      await this.db.withWriteTransaction(async (client) => {
        const lock = await client.query<{ ok: boolean }>(
          'SELECT pg_try_advisory_xact_lock(814201) AS ok',
        );
        if (!lock.rows[0].ok) return;
        await client.query(
          `UPDATE seats s
              SET state = 'available', current_hold_id = NULL
             FROM holds h
            WHERE s.current_hold_id = h.id
              AND s.state = 'held'
              AND NOT (h.status = 'active' AND h.expires_at > now())`,
        );
      });
    } catch (error) {
      this.logger.warn(error instanceof Error ? error.message : String(error));
    }
  }
}
