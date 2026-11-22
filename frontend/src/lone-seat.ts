import { Seat } from './api';

export const LONE_SEAT_MESSAGE =
  'That choice would leave a single empty seat stuck on its own. Pick different seats.';

type Cell = 'free' | 'taken';

/** A free seat is lone when both sides are taken or the end of the row. */
function isLone(cells: Cell[], index: number): boolean {
  if (cells[index] !== 'free') return false;
  const leftBlocked = index === 0 || cells[index - 1] !== 'free';
  const rightBlocked = index === cells.length - 1 || cells[index + 1] !== 'free';
  return leftBlocked && rightBlocked;
}

/** True only when this hold would create a lone seat that was not already lone. */
function createsNewLoneSeat(before: Cell[], takenIndexes: number[]): boolean {
  const after = before.slice();
  for (const index of takenIndexes) {
    if (after[index] === 'free') after[index] = 'taken';
  }
  for (let index = 0; index < after.length; index++) {
    if (isLone(after, index) && !isLone(before, index)) return true;
  }
  return false;
}

/** The whole selection is judged together, the same way the hold request is. */
export function selectionLeavesLoneSeat(seats: Seat[], selection: string[]): boolean {
  if (selection.length === 0) return false;
  const selected = new Set(selection);
  const rows = new Map<string, Seat[]>();
  for (const seat of seats) {
    const list = rows.get(seat.row) ?? [];
    list.push(seat);
    rows.set(seat.row, list);
  }
  for (const rowSeats of rows.values()) {
    rowSeats.sort((a, b) => a.number - b.number);
    const before: Cell[] = [];
    const chosen: number[] = [];
    for (const seat of rowSeats) {
      before.push(seat.status === 'available' ? 'free' : 'taken');
      if (selected.has(seat.id)) chosen.push(before.length - 1);
    }
    if (chosen.length > 0 && createsNewLoneSeat(before, chosen)) return true;
  }
  return false;
}
