export function indexToLabel(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function labelToIndex(label: string): number {
  let n = 0;
  for (const ch of label.toUpperCase()) {
    if (ch < 'A' || ch > 'Z') return -1;
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}

const SEAT_ID = /^([A-Za-z]+)([1-9][0-9]*)$/;

export type SeatKey = {
  rowIndex: number;
  seatNumber: number;
  id: string;
};

export function parseSeatId(raw: string): SeatKey | null {
  const match = SEAT_ID.exec(raw.trim());
  if (!match) return null;
  const rowIndex = labelToIndex(match[1]);
  if (rowIndex < 0) return null;
  const seatNumber = Number(match[2]);
  return {
    rowIndex,
    seatNumber,
    id: `${indexToLabel(rowIndex)}${seatNumber}`,
  };
}

export function compareSeats(a: SeatKey, b: SeatKey): number {
  return a.rowIndex - b.rowIndex || a.seatNumber - b.seatNumber;
}
