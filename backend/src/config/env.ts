export type Env = {
  databaseUrl: string;
  holdTtlSeconds: number;
  maxSeatsPerUser: number;
  loneSeatRule: boolean;
  sweeperEnabled: boolean;
  seedDemo: boolean;
  port: number;
  writePoolMax: number;
  readPoolMax: number;
};

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const databaseUrl = source.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }
  return {
    databaseUrl,
    holdTtlSeconds: positiveInt(source.HOLD_TTL_SECONDS, 'HOLD_TTL_SECONDS'),
    maxSeatsPerUser: positiveInt(source.MAX_SEATS_PER_USER, 'MAX_SEATS_PER_USER'),
    loneSeatRule: source.LONE_SEAT_RULE === 'true',
    sweeperEnabled: source.SWEEPER_ENABLED !== 'false',
    seedDemo: source.SEED_DEMO !== 'false',
    port: source.PORT ? positiveInt(source.PORT, 'PORT') : 3000,
    writePoolMax: source.WRITE_POOL_MAX
      ? positiveInt(source.WRITE_POOL_MAX, 'WRITE_POOL_MAX')
      : 10,
    readPoolMax: source.READ_POOL_MAX
      ? positiveInt(source.READ_POOL_MAX, 'READ_POOL_MAX')
      : 10,
  };
}

function positiveInt(value: string | undefined, name: string): number {
  if (value == null || !/^[1-9]\d*$/.test(value)) {
    throw new Error(`${name} must be an integer >= 1`);
  }
  return Number(value);
}
