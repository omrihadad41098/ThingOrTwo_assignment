import { Seat, Zone } from '../api';
import { formatAgorot } from '../format';

const ZONE_CLASS = ['stalls', 'circle', 'balcony'];

export function SeatMap({
  seats,
  zones,
  selected,
  heldByYou,
  onToggle,
  disabled,
}: {
  seats: Seat[];
  zones: Zone[];
  selected: string[];
  heldByYou: string[];
  onToggle: (seat: Seat) => void;
  disabled: boolean;
}) {
  const mine = new Set(heldByYou);
  const rows = [...new Set(seats.map((seat) => seat.row))];
  return (
    <div className="house">
      <div className="stage">Stage</div>
      {rows.map((row) => (
        <div className="seat-row" key={row}>
          <span className="row-label">{row}</span>
          {seats
            .filter((seat) => seat.row === row)
            .map((seat) => {
              const zoneIndex = Math.max(
                0,
                zones.findIndex((zone) => zone.id === seat.zoneId),
              );
              const zone = zones[zoneIndex];
              const isMine = mine.has(seat.id);
              const isSelected = !isMine && seat.status === 'available' && selected.includes(seat.id);
              const takenByOther = seat.status === 'held' && !isMine;
              const zoneClass =
                seat.status === 'available' && !isSelected ? (ZONE_CLASS[zoneIndex] ?? 'stalls') : '';
              const state = isMine ? 'mine' : isSelected ? 'selected' : takenByOther ? 'held' : seat.status;
              const words = isMine
                ? 'held by you'
                : isSelected
                  ? 'selected'
                  : takenByOther
                    ? 'held by someone else'
                    : seat.status;
              return (
                <button
                  key={seat.id}
                  type="button"
                  className={`seat ${zoneClass} ${state}`.trim()}
                  aria-label={`Row ${seat.row} seat ${seat.number}, ${zone?.name ?? 'seat'}, ${formatAgorot(seat.priceAgorot)}, ${words}`}
                  aria-pressed={isSelected}
                  disabled={disabled || seat.status !== 'available'}
                  onClick={() => onToggle(seat)}
                >
                  {seat.number}
                </button>
              );
            })}
        </div>
      ))}
      <ul className="legend">
        <li><span className="swatch available" /> Available</li>
        <li><span className="swatch selected" /> Your pick</li>
        <li><span className="swatch mine" /> Your hold</li>
        <li><span className="swatch held" /> Held by someone else</li>
        <li><span className="swatch sold" /> Sold</li>
      </ul>
    </div>
  );
}
