import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, EventSummary } from '../api';
import { Countdown } from '../components/Countdown';
import { clockOffset } from '../format';

export function Events() {
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    async function tick() {
      if (cancelled) return;
      if (!document.hidden) {
        try {
          const next = await api<EventSummary[]>('/events');
          if (!cancelled) {
            setEvents(next);
            setError('');
          }
        } catch (caught) {
          if (!cancelled) setError(caught instanceof Error ? caught.message : 'Could not load shows.');
        }
      }
      if (!cancelled) timer = window.setTimeout(() => void tick(), 5000);
    }
    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  const offset = events[0] ? clockOffset(events[0].serverNow) : 0;

  return (
    <section>
      <p className="eyebrow">Tonight</p>
      <h1>Shows</h1>
      {error ? <p className="error">{error}</p> : null}
      <div className="cards">
        {events.map((event) => (
          <Link key={event.id} to={`/events/${event.id}`} className="card">
            <h2>{event.name}</h2>
            <p>{event.seatCount} seats</p>
            {event.onSale ? (
              <p className="on-sale">On sale</p>
            ) : (
              <p>
                Doors in <Countdown expiresAt={event.dropAt} offset={offset} />
              </p>
            )}
          </Link>
        ))}
      </div>
      {events.length === 0 && !error ? <p>No shows yet.</p> : null}
    </section>
  );
}
