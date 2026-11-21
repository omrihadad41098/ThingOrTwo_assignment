type Cell = 'free' | 'taken';

export const LONE_SEAT_MESSAGE =
  'That choice would leave a single empty seat stuck on its own. Pick different seats.';

/** A free seat is lone when both sides are taken or the end of the row. */
export function isLone(cells: Cell[], index: number): boolean {
  if (cells[index] !== 'free') return false;
  const leftBlocked = index === 0 || cells[index - 1] !== 'free';
  const rightBlocked = index === cells.length - 1 || cells[index + 1] !== 'free';
  return leftBlocked && rightBlocked;
}

/** True only when this hold would create a lone seat that was not already lone. */
export function createsNewLoneSeat(before: Cell[], takenIndexes: number[]): boolean {
  const after = before.slice();
  for (const index of takenIndexes) {
    if (after[index] === 'free') after[index] = 'taken';
  }
  for (let index = 0; index < after.length; index++) {
    if (isLone(after, index) && !isLone(before, index)) return true;
  }
  return false;
}
