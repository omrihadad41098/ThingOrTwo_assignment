export function percentOff(subtotalAgorot: number, percent: number): number {
  return Math.floor((subtotalAgorot * percent + 50) / 100);
}

export function applyDiscount(
  subtotalAgorot: number,
  code: string | null,
): { discountAgorot: number; totalAgorot: number; promoCode: string | null } {
  if (!code) {
    return { discountAgorot: 0, totalAgorot: subtotalAgorot, promoCode: null };
  }
  const normalized = code.trim().toUpperCase();
  if (normalized === 'SAVE10') {
    const discountAgorot = percentOff(subtotalAgorot, 10);
    return {
      discountAgorot,
      totalAgorot: Math.max(0, subtotalAgorot - discountAgorot),
      promoCode: 'SAVE10',
    };
  }
  if (normalized === 'WELCOME20') {
    const discountAgorot = Math.min(2000, subtotalAgorot);
    return {
      discountAgorot,
      totalAgorot: subtotalAgorot - discountAgorot,
      promoCode: 'WELCOME20',
    };
  }
  return { discountAgorot: 0, totalAgorot: subtotalAgorot, promoCode: null };
}

export function quotePromo(
  subtotalAgorot: number,
  code: string | null | undefined,
): { discountAgorot: number; totalAgorot: number; promoCode: string | null; unknown: boolean } {
  const trimmed = code?.trim() ?? '';
  if (!trimmed) {
    return { ...applyDiscount(subtotalAgorot, null), unknown: false };
  }
  const normalized = trimmed.toUpperCase();
  if (normalized !== 'SAVE10' && normalized !== 'WELCOME20') {
    return { discountAgorot: 0, totalAgorot: subtotalAgorot, promoCode: null, unknown: true };
  }
  return { ...applyDiscount(subtotalAgorot, normalized), unknown: false };
}
