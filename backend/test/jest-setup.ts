process.env.SWEEPER_ENABLED ??= 'false';
process.env.SEED_DEMO ??= 'false';
process.env.WRITE_POOL_MAX ??= '50';
process.env.HOLD_TTL_SECONDS ??= '300';
process.env.MAX_SEATS_PER_USER ??= '4';
process.env.LONE_SEAT_RULE ??= 'false';
process.env.DATABASE_URL ??= 'postgres://seatrush:seatrush@localhost:5432/seatrush_test';
