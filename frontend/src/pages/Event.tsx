import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { api, ApiError, CreatedHold, Order, Seat, SeatMap as MapPayload } from '../api';
import { Countdown } from '../components/Countdown';
import { SeatMap } from '../components/SeatMap';
import { useFan } from '../fan';
import { clockOffset, formatAgorot, joinSeats, previewCoupon } from '../format';

export function EventPage() {
  const { id = '' } = useParams();
  const { fan } = useFan();
  const [map, setMap] = useState<MapPayload | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState('');
  const [pending, setPending] = useState(false);
  const [slow, setSlow] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [bestCount, setBestCount] = useState(2);
  const [coupon, setCoupon] = useState('');
  const [oneSeatMode, setOneSeatMode] = useState(
    () => sessionStorage.getItem('oneSeatMode') === '1',
  );
  const inFlight = useRef(false);
  const expired = useRef(new Set<string>());

  const load = useCallback(async () => {
    const next = await api<MapPayload>(`/events/${id}/map`, { fan });
    setMap(next);
    setSelection((current) =>
      current.filter((seatId) => {
        const seat = next.seats.find((item) => item.id === seatId);
        return seat != null && seat.status !== 'sold';
      }),
    );
    return next;
  }, [fan, id]);

  useEffect(() => {
    if (!fan) return;
    let cancelled = false;
    let timer = 0;
    async function tick() {
      if (cancelled) return;
      if (!document.hidden) {
        try {
          await load();
          if (!cancelled) setMessage((current) => (current ? current : ''));
        } catch (caught) {
          if (!cancelled) setMessage(caught instanceof Error ? caught.message : 'Could not load the map.');
        }
      }
      if (!cancelled) timer = window.setTimeout(() => void tick(), 2000);
    }
    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [fan, load]);

  if (!fan) return <Navigate to="/" replace />;
  if (!map) return <p className="loading">Setting the room...</p>;

  const cap = Math.min(4, map.you?.remaining ?? map.maxSeatsPerUser);
  const offset = clockOffset(map.serverNow);
  const selectedSeats = map.seats.filter((seat) => selection.includes(seat.id));
  const selectedTotal = selectedSeats.reduce((sum, seat) => sum + seat.priceAgorot, 0);

  function toggle(seat: Seat) {
    if (!map?.event.onSale || pending) return;
    setSuccess('');
    setSelection((current) => {
      if (current.includes(seat.id)) return current.filter((item) => item !== seat.id);
      if (seat.status === 'sold' || current.length >= cap) return current;
      return [...current, seat.id];
    });
  }

  async function run(action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setSlow(false);
    const timer = window.setTimeout(() => setSlow(true), 800);
    try {
      await action();
    } catch (caught) {
      const error = caught instanceof ApiError ? caught : null;
      setMessage(error?.message ?? (caught instanceof Error ? caught.message : 'Please try again.'));
      if (error?.status === 409) {
        const blocked = new Set(error.seatIds ?? []);
        setSelection((current) => current.filter((seatId) => !blocked.has(seatId)));
        await load().catch(() => undefined);
      }
    } finally {
      window.clearTimeout(timer);
      setSlow(false);
      setPending(false);
      inFlight.current = false;
    }
  }

  function holdSelected() {
    void run(async () => {
      const created = await api<CreatedHold>(`/events/${id}/holds`, {
        fan,
        body: { seatIds: selection, ...(oneSeatMode ? { oneSeatMode: true } : {}) },
      });
      setSelection([]);
      setMessage('');
      setSuccess(`Held ${joinSeats(created.seatIds)} for ${formatAgorot(created.totalAgorot)}.`);
      await load();
    });
  }

  function holdBest() {
    void run(async () => {
      const created = await api<CreatedHold>(`/events/${id}/holds`, {
        fan,
        body: {
          bestAvailable: { count: Math.min(bestCount, cap) },
          ...(oneSeatMode ? { oneSeatMode: true } : {}),
        },
      });
      setMessage('');
      setSuccess(`Held ${joinSeats(created.seatIds)} for ${formatAgorot(created.totalAgorot)}.`);
      await load();
    });
  }

  function buy(holdId: string) {
    void run(async () => {
      const code = coupon.trim();
      const order = await api<Order>(`/holds/${holdId}/checkout`, {
        fan,
        body: code ? { promoCode: code } : {},
      });
      setConfirming(null);
      setCoupon('');
      setMessage('');
      const price = order.discountAgorot > 0 ? ` ${formatAgorot(order.totalAgorot)}.` : '';
      setSuccess(`You're going. Seats ${joinSeats(order.seatIds)}.${price}`);
      await load();
    });
  }

  function cancel(holdId: string) {
    void run(async () => {
      await api(`/holds/${holdId}/release`, { fan, body: {} });
      setConfirming((current) => (current === holdId ? null : current));
      setMessage('');
      setSuccess('Those seats are available again.');
      await load();
    });
  }

  function toggleOneSeatMode() {
    setOneSeatMode((current) => {
      const next = !current;
      sessionStorage.setItem('oneSeatMode', next ? '1' : '0');
      return next;
    });
  }

  return (
    <section className="event">
      <div>
        <p className="eyebrow">{map.event.venue}</p>
        <h1>{map.event.name}</h1>
        {!map.event.onSale ? (
          <p>
            Tickets go on sale in <Countdown expiresAt={map.event.dropAt} offset={offset} />
          </p>
        ) : (
          <p>
            {cap} seat{cap === 1 ? '' : 's'} left in your limit of {map.maxSeatsPerUser}.
          </p>
        )}
        <SeatMap
          seats={map.seats}
          zones={map.zones}
          selected={selection}
          onToggle={toggle}
          disabled={!map.event.onSale || pending}
        />
      </div>
      <aside className="panel">
        {success ? <p className="success">{success}</p> : null}
        {message ? <p className="error">{message}</p> : null}
        {slow ? <p>Still working. A lot of people are buying right now.</p> : null}
        <button
          type="button"
          className={oneSeatMode ? 'mode on' : 'mode'}
          aria-pressed={oneSeatMode}
          onClick={toggleOneSeatMode}
        >
          OneSeatMode
        </button>
        <p className="hint">
          {oneSeatMode
            ? 'On. A hold that would leave one empty seat stuck on its own is refused.'
            : 'Off. Seats can be held without the single-seat check.'}
        </p>
        <h2>Your seats</h2>
        {selectedSeats.length === 0 ? <p>Click seats, or ask for the best that are left.</p> : null}
        {selectedSeats.length > 0 ? (
          <>
            <p>
              {joinSeats(selectedSeats.map((seat) => seat.id))} · {formatAgorot(selectedTotal)}
            </p>
            <button type="button" disabled={pending} onClick={holdSelected}>
              Hold these seats
            </button>
          </>
        ) : null}
        {map.event.onSale && cap > 0 ? (
          <form
            className="best"
            onSubmit={(event) => {
              event.preventDefault();
              holdBest();
            }}
          >
            <label htmlFor="best-count">Best available</label>
            <select
              id="best-count"
              value={bestCount}
              onChange={(event) => setBestCount(Number(event.target.value))}
            >
              {Array.from({ length: cap }, (_, index) => index + 1).map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
            <button type="submit" disabled={pending}>
              Find seats
            </button>
          </form>
        ) : null}
        {(map.you?.holds ?? [])
          .filter((hold) => !expired.current.has(hold.id))
          .map((hold) => (
            <article key={hold.id} className="hold">
              <h3>{joinSeats(hold.seatIds)}</h3>
              <p>
                {formatAgorot(hold.totalAgorot)} ·{' '}
                <Countdown
                  expiresAt={hold.expiresAt}
                  offset={offset}
                  onZero={() => {
                    expired.current.add(hold.id);
                    setConfirming((current) => (current === hold.id ? null : current));
                    void load();
                  }}
                />
              </p>
              <label className="coupon" htmlFor={`coupon-${hold.id}`}>
                Coupon code
                <input
                  id={`coupon-${hold.id}`}
                  value={coupon}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="SAVE10 or WELCOME20"
                  onChange={(event) => setCoupon(event.target.value)}
                />
              </label>
              <CouponLine subtotal={hold.totalAgorot} raw={coupon} />
              {confirming === hold.id ? (
                <p>No payment is taken. Confirming reserves the seats in your name.</p>
              ) : null}
              <div className="actions">
                {confirming === hold.id ? (
                  <button type="button" disabled={pending} onClick={() => buy(hold.id)}>
                    Confirm
                  </button>
                ) : (
                  <button type="button" disabled={pending} onClick={() => setConfirming(hold.id)}>
                    Checkout
                  </button>
                )}
                <button type="button" className="text" disabled={pending} onClick={() => cancel(hold.id)}>
                  Cancel
                </button>
              </div>
            </article>
          ))}
        <p>
          <Link to="/tickets">My tickets</Link>
        </p>
      </aside>
    </section>
  );
}

function CouponLine({ subtotal, raw }: { subtotal: number; raw: string }) {
  const quote = previewCoupon(subtotal, raw);
  if (!raw.trim()) return null;
  if (quote.unknown) return <p className="error">That coupon code isn't valid.</p>;
  return (
    <p>
      {formatAgorot(subtotal)} minus {formatAgorot(quote.discountAgorot)} is{' '}
      {formatAgorot(quote.totalAgorot)}.
    </p>
  );
}
