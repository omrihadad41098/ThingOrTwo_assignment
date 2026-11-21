import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api, LiveHold, Order } from '../api';
import { Countdown } from '../components/Countdown';
import { useFan } from '../fan';
import { clockOffset, formatAgorot, joinSeats } from '../format';

export function Tickets() {
  const { fan } = useFan();
  const [holds, setHolds] = useState<LiveHold[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!fan) return;
    let cancelled = false;
    Promise.all([
      api<LiveHold[]>('/me/holds', { fan }),
      api<Order[]>('/me/orders', { fan }),
    ])
      .then(([nextHolds, nextOrders]) => {
        if (cancelled) return;
        setHolds(nextHolds);
        setOrders(nextOrders);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Could not load tickets.');
      });
    return () => {
      cancelled = true;
    };
  }, [fan]);

  if (!fan) return <Navigate to="/" replace />;
  const empty = !error && holds.length === 0 && orders.length === 0;

  return (
    <section>
      <p className="eyebrow">Your night</p>
      <h1>My tickets</h1>
      {error ? <p className="error">{error}</p> : null}
      {empty ? <p>You don't have tickets yet.</p> : null}
      {holds.map((hold) => (
        <article key={hold.id} className="card static">
          <h2>{hold.eventName}</h2>
          <p>Hold on {joinSeats(hold.seatIds)}</p>
          <p>
            <Countdown
              expiresAt={hold.expiresAt}
              offset={clockOffset(hold.serverNow ?? new Date().toISOString())}
            />
          </p>
          <Link to={`/events/${hold.eventId}`}>Back to the map</Link>
        </article>
      ))}
      {orders.map((order) => (
        <article key={order.id} className="card static">
          <h2>{order.eventName}</h2>
          <p>You're going. Seats {joinSeats(order.seatIds)}.</p>
          <p>{formatAgorot(order.totalAgorot)}</p>
        </article>
      ))}
    </section>
  );
}
