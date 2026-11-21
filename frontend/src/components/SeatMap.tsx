import { Seat, Zone } from '../api';
import { formatAgorot } from '../format';

const ZONE_CLASS = ['stalls', 'circle', 'balcony'];

export function SeatMap({
  seats,
  zones,
  selected,
  onToggle,
  disabled,
}: {
  seats: Seat[];
  zones: Zone[];
  selected: string[];
  onToggle: (seat: Seat) => void;
  disabled: boolean;
}) {
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
              const isSelected = selected.includes(seat.id);
              const zoneClass = ZONE_CLASS[zoneIndex] ?? 'stalls';
              return (
                <button
                  key={seat.id}
                  type="button"
                  className={`seat ${zoneClass} ${seat.status} ${isSelected ? 'selected' : ''}`}
                  aria-label={`Row ${seat.row} seat ${seat.number}, ${zone?.name ?? 'seat'}, ${formatAgorot(seat.priceAgorot)}, ${seat.status}`}
                  aria-pressed={isSelected}
                  disabled={disabled || seat.status === 'sold'}
                  onClick={() => onToggle(seat)}
                >
                  {seat.number}
                </button>
              );
            })}
        </div>
      ))}
    </div>
  );
}
