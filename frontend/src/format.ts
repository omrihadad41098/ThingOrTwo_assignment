export function formatAgorot(agorot: number): string {
  const value = Math.trunc(agorot);
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const shekels = Math.floor(abs / 100);
  const cents = abs % 100;
  return `ILS ${sign}${shekels}.${String(cents).padStart(2, '0')}`;
}

export function joinSeats(ids: string[]): string {
  if (ids.length <= 1) return ids[0] ?? '';
  if (ids.length === 2) return `${ids[0]} and ${ids[1]}`;
  return `${ids.slice(0, -1).join(', ')}, and ${ids[ids.length - 1]}`;
}

export function previewCoupon(
  subtotalAgorot: number,
  raw: string,
): { code: string | null; discountAgorot: number; totalAgorot: number; unknown: boolean } {
  const trimmed = raw.trim().toUpperCase();
  if (!trimmed) {
    return { code: null, discountAgorot: 0, totalAgorot: subtotalAgorot, unknown: false };
  }
  if (trimmed === 'SAVE10') {
    const discountAgorot = Math.floor((subtotalAgorot * 10 + 50) / 100);
    return {
      code: 'SAVE10',
      discountAgorot,
      totalAgorot: Math.max(0, subtotalAgorot - discountAgorot),
      unknown: false,
    };
  }
  if (trimmed === 'WELCOME20') {
    const discountAgorot = Math.min(2000, subtotalAgorot);
    return {
      code: 'WELCOME20',
      discountAgorot,
      totalAgorot: subtotalAgorot - discountAgorot,
      unknown: false,
    };
  }
  return { code: null, discountAgorot: 0, totalAgorot: subtotalAgorot, unknown: true };
}

export function clockOffset(serverNow: string): number {
  return Date.parse(serverNow) - Date.now();
}

export function remainingMs(expiresAt: string, offset: number, now = Date.now()): number {
  return Date.parse(expiresAt) - (now + offset);
}
