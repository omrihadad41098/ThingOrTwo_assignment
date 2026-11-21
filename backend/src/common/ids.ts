import { notFound } from './errors';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireUuid(value: string, noun: 'event' | 'hold'): string {
  if (!UUID.test(value)) {
    throw notFound(noun === 'event' ? "We couldn't find that event." : "We couldn't find that hold.");
  }
  return value;
}
