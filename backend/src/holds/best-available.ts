import { createsNewLoneSeat } from './lone-seat';

export type Cell = 'free' | 'taken';

export type SeatRow = {
  index: number;
  cells: Cell[];
  priceAgorot: number;
  zoneId: string;
};

export function chooseBlock(input: {
  rows: SeatRow[];
  count: number;
  maxPriceAgorot?: number;
  zoneId?: string;
  loneSeatRule?: boolean;
}): { rowIndex: number; startNumber: number } | null {
  const candidates: { rowIndex: number; start: number; distance: number }[] = [];
  for (const row of input.rows) {
    if (input.zoneId && row.zoneId !== input.zoneId) continue;
    if (input.maxPriceAgorot != null && row.priceAgorot > input.maxPriceAgorot) continue;
    const seatsPerRow = row.cells.length;
    const rowCenter = (1 + seatsPerRow) / 2;
    for (let start = 1; start <= seatsPerRow - input.count + 1; start++) {
      let free = true;
      for (let offset = 0; offset < input.count; offset++) {
        if (row.cells[start - 1 + offset] !== 'free') {
          free = false;
          break;
        }
      }
      if (!free) continue;
      if (input.loneSeatRule) {
        const taken: number[] = [];
        for (let offset = 0; offset < input.count; offset++) taken.push(start - 1 + offset);
        if (createsNewLoneSeat(row.cells, taken)) continue;
      }
      const end = start + input.count - 1;
      const blockCenter = (start + end) / 2;
      candidates.push({
        rowIndex: row.index,
        start,
        distance: Math.abs(blockCenter - rowCenter),
      });
    }
  }
  candidates.sort(
    (a, b) => a.rowIndex - b.rowIndex || a.distance - b.distance || a.start - b.start,
  );
  const winner = candidates[0];
  if (!winner) return null;
  return { rowIndex: winner.rowIndex, startNumber: winner.start };
}
