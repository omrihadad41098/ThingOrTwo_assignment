const base = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly seatIds?: string[];

  constructor(status: number, code: string, message: string, seatIds?: string[]) {
    super(message);
    this.status = status;
    this.code = code;
    this.seatIds = seatIds;
  }
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; fan?: string | null } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.fan) headers['X-Fan-Username'] = options.fan;
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? (options.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!response.ok) {
    throw new ApiError(
      response.status,
      String(data.code ?? 'INTERNAL'),
      String(data.message ?? 'Something went wrong. Please try again.'),
      Array.isArray(data.seatIds) ? data.seatIds.map(String) : undefined,
    );
  }
  return data as T;
}

export type Zone = {
  id: string;
  name: string;
  fromRow: string;
  toRow: string;
  priceAgorot: number;
};

export type Seat = {
  id: string;
  row: string;
  number: number;
  zoneId: string;
  priceAgorot: number;
  status: 'available' | 'held' | 'sold';
};

export type LiveHold = {
  id: string;
  expiresAt: string;
  seatIds: string[];
  totalAgorot: number;
  eventId?: string;
  eventName?: string;
  serverNow?: string;
};

export type EventSummary = {
  id: string;
  name: string;
  venue: string;
  startsAt: string;
  dropAt: string;
  serverNow: string;
  rowCount: number;
  seatsPerRow: number;
  seatCount: number;
  onSale: boolean;
};

export type SeatMap = {
  event: {
    id: string;
    name: string;
    venue: string;
    startsAt: string;
    dropAt: string;
    onSale: boolean;
    rowCount: number;
    seatsPerRow: number;
  };
  serverNow: string;
  maxSeatsPerUser: number;
  holdTtlSeconds: number;
  zones: Zone[];
  seats: Seat[];
  you: {
    username: string;
    used: number;
    remaining: number;
    holds: LiveHold[];
  } | null;
};

export type CreatedHold = {
  id: string;
  eventId: string;
  expiresAt: string;
  serverNow: string;
  seatIds: string[];
  totalAgorot: number;
};

export type Order = {
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
