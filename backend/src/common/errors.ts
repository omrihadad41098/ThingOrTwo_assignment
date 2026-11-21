export class DomainError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly seatIds?: string[],
  ) {
    super(message);
  }
}

export function notFound(message: string): DomainError {
  return new DomainError(404, 'NOT_FOUND', message);
}

export function validation(message: string, seatIds?: string[]): DomainError {
  return new DomainError(400, 'VALIDATION', message, seatIds);
}

export function forbidden(message = 'This hold belongs to another fan.'): DomainError {
  return new DomainError(403, 'FORBIDDEN', message);
}

export function unauthenticated(): DomainError {
  return new DomainError(
    401,
    'UNAUTHENTICATED',
    'Tell us who you are with the X-Fan-Username header.',
  );
}

export function busy(): DomainError {
  return new DomainError(
    503,
    'BUSY',
    'Too many people are trying for these seats. Please try again.',
  );
}

export function joinIds(ids: string[]): string {
  if (ids.length <= 1) return ids[0] ?? '';
  if (ids.length === 2) return `${ids[0]} and ${ids[1]}`;
  return `${ids.slice(0, -1).join(', ')}, and ${ids[ids.length - 1]}`;
}

export type SeatProblem = {
  id: string;
  reason: 'missing' | 'sold' | 'held_by_you' | 'held_by_other';
};

export function seatConflict(problems: SeatProblem[], requested: number): DomainError {
  const missing = problems.filter((p) => p.reason === 'missing').map((p) => p.id);
  if (missing.length) {
    const list = joinIds(missing);
    const message =
      missing.length === 1
        ? `${list} isn't a seat in this event.`
        : `${list} aren't seats in this event.`;
    return validation(message, missing);
  }
  const sold = problems.filter((p) => p.reason === 'sold').map((p) => p.id);
  const mine = problems.filter((p) => p.reason === 'held_by_you').map((p) => p.id);
  const other = problems.filter((p) => p.reason === 'held_by_other').map((p) => p.id);
  const prefix = requested > 1 ? 'Nothing was held. ' : '';
  const seatIds = [...sold, ...mine, ...other];
  let sentence: string;
  if (sold.length && !mine.length && !other.length) {
    sentence =
      sold.length === 1
        ? `${sold[0]} is already sold.`
        : `${joinIds(sold)} are already sold.`;
  } else if (mine.length && !sold.length && !other.length) {
    sentence =
      mine.length === 1
        ? `You already hold ${mine[0]}.`
        : `You already hold ${joinIds(mine)}.`;
  } else if (other.length && !sold.length && !mine.length) {
    sentence =
      other.length === 1
        ? `Someone just took ${other[0]}.`
        : `Someone just took ${joinIds(other)}.`;
  } else {
    const parts: string[] = [];
    if (sold.length) {
      parts.push(
        sold.length === 1
          ? `${sold[0]} is already sold`
          : `${joinIds(sold)} are already sold`,
      );
    }
    if (mine.length) {
      parts.push(
        mine.length === 1
          ? `you already hold ${mine[0]}`
          : `you already hold ${joinIds(mine)}`,
      );
    }
    if (other.length) {
      parts.push(
        other.length === 1
          ? `someone just took ${other[0]}`
          : `someone just took ${joinIds(other)}`,
      );
    }
    const body = parts.join(', and ');
    sentence = `${body.charAt(0).toUpperCase()}${body.slice(1)}.`;
  }
  return new DomainError(409, 'SEAT_UNAVAILABLE', prefix + sentence, seatIds);
}
