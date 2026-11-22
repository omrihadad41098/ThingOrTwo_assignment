import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, EventSummary } from '../api';
import { useFan } from '../fan';
import { formatAgorot, shekelsToAgorot } from '../format';

type FanAccount = {
  username: string;
  createdAt: string;
  holdCount: number;
  orderCount: number;
};

type ZoneDraft = {
  key: number;
  name: string;
  fromRow: string;
  toRow: string;
  price: string;
};

type CreatedShow = {
  id: string;
  name: string;
  seatCount: number;
  zones: { name: string; fromRow: string; toRow: string; priceAgorot: number }[];
};

export function Admin() {
  const [revision, setRevision] = useState(0);
  return (
    <section className="admin">
      <CreateShow onCreated={() => setRevision((value) => value + 1)} />
      <ExistingShows revision={revision} />
      <Fans />
    </section>
  );
}

function CreateShow({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [dropAt, setDropAt] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [rowCount, setRowCount] = useState('8');
  const [seatsPerRow, setSeatsPerRow] = useState('12');
  const [zones, setZones] = useState<ZoneDraft[]>([
    { key: 1, name: 'Stalls', fromRow: 'A', toRow: 'H', price: '150.00' },
  ]);
  const [nextKey, setNextKey] = useState(2);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [tone, setTone] = useState<'ok' | 'bad'>('ok');
  const [created, setCreated] = useState<CreatedShow | null>(null);

  const rows = Number(rowCount);
  const lastRow = Number.isInteger(rows) && rows >= 1 && rows <= 60 ? indexToLabel(rows - 1) : '';

  function updateZone(key: number, patch: Partial<ZoneDraft>) {
    setZones((current) => current.map((zone) => (zone.key === key ? { ...zone, ...patch } : zone)));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const drop = localInputToIso(dropAt);
    const start = localInputToIso(startsAt);
    const parsedRows = Number(rowCount);
    const parsedSeats = Number(seatsPerRow);
    if (!name.trim() || !drop || !start) {
      setTone('bad');
      setCreated(null);
      setMessage('Name, drop time, and show time are required.');
      return;
    }
    if (!Number.isInteger(parsedRows) || !Number.isInteger(parsedSeats)) {
      setTone('bad');
      setCreated(null);
      setMessage('Rows and seats per row must be whole numbers.');
      return;
    }
    const priced = zones.map((zone) => ({
      name: zone.name.trim(),
      fromRow: zone.fromRow.trim(),
      toRow: zone.toRow.trim(),
      priceAgorot: shekelsToAgorot(zone.price),
    }));
    if (priced.some((zone) => !zone.name || !zone.fromRow || !zone.toRow || zone.priceAgorot == null)) {
      setTone('bad');
      setCreated(null);
      setMessage('Each zone needs a name, two row letters, and a price like 150.00.');
      return;
    }
    setPending(true);
    setMessage('');
    setCreated(null);
    try {
      const show = await api<CreatedShow>('/events', {
        body: {
          name: name.trim(),
          venue: name.trim(),
          dropAt: drop,
          startsAt: start,
          rowCount: parsedRows,
          seatsPerRow: parsedSeats,
          zones: priced,
        },
      });
      setTone('ok');
      setCreated(show);
      setMessage(`${show.name} is on the board. ${show.seatCount} seats.`);
      setName('');
      onCreated();
    } catch (caught) {
      setTone('bad');
      setMessage(caught instanceof ApiError ? caught.message : 'Could not create that show.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="show-form" onSubmit={(event) => void submit(event)}>
      <h1>New show</h1>
      <p>
        Every row has the same number of seats. A price zone is a run of rows, and together the zones must cover
        {lastRow ? ` A through ${lastRow}` : ' every row'} with no gaps. The drop has to be before the show starts.
      </p>
      <label>
        Name
        <input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
      </label>
      <div className="pair">
        <label>
          Tickets go on sale
          <input type="datetime-local" value={dropAt} onChange={(event) => setDropAt(event.target.value)} />
        </label>
        <label>
          Show starts
          <input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
        </label>
      </div>
      <div className="pair">
        <label>
          Rows
          <input value={rowCount} inputMode="numeric" onChange={(event) => setRowCount(event.target.value)} />
        </label>
        <label>
          Seats per row
          <input value={seatsPerRow} inputMode="numeric" onChange={(event) => setSeatsPerRow(event.target.value)} />
        </label>
      </div>
      <div className="zones">
        {zones.map((zone) => (
          <div className="zone-row" key={zone.key}>
            <label>
              Zone
              <input value={zone.name} onChange={(event) => updateZone(zone.key, { name: event.target.value })} />
            </label>
            <label>
              From row
              <input value={zone.fromRow} onChange={(event) => updateZone(zone.key, { fromRow: event.target.value })} />
            </label>
            <label>
              To row
              <input value={zone.toRow} onChange={(event) => updateZone(zone.key, { toRow: event.target.value })} />
            </label>
            <label>
              Price (ILS)
              <input value={zone.price} onChange={(event) => updateZone(zone.key, { price: event.target.value })} />
            </label>
            {zones.length > 1 ? (
              <button
                type="button"
                className="text"
                onClick={() => setZones((current) => current.filter((item) => item.key !== zone.key))}
              >
                Remove
              </button>
            ) : (
              <span />
            )}
          </div>
        ))}
      </div>
      <div className="actions">
        <button
          type="button"
          className="text"
          onClick={() => {
            setZones((current) => [...current, { key: nextKey, name: '', fromRow: '', toRow: '', price: '' }]);
            setNextKey((key) => key + 1);
          }}
        >
          Add zone
        </button>
        <button type="submit" disabled={pending}>
          Create show
        </button>
      </div>
      {message ? <p className={tone === 'ok' ? 'success' : 'error'}>{message}</p> : null}
      {created ? (
        <p>
          <Link to={`/events/${created.id}`}>{created.name}</Link>
          {created.zones.map((zone) => (
            <span key={`${zone.name}-${zone.fromRow}`}>
              {' '}
              · {zone.name} {zone.fromRow}-{zone.toRow} {formatAgorot(zone.priceAgorot)}
            </span>
          ))}
        </p>
      ) : null}
    </form>
  );
}

function ExistingShows({ revision }: { revision: number }) {
  const [shows, setShows] = useState<EventSummary[] | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [tone, setTone] = useState<'ok' | 'bad'>('ok');
  const [armed, setArmed] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    const next = await api<EventSummary[]>('/events');
    setShows(next);
    setError('');
  }, []);

  useEffect(() => {
    void load().catch((caught) => {
      setError(caught instanceof Error ? caught.message : 'Could not load shows.');
    });
  }, [load, revision]);

  async function remove(show: EventSummary) {
    if (pending) return;
    setPending(true);
    setTone('ok');
    setMessage('');
    try {
      await api(`/admin/events/${show.id}`, { method: 'DELETE' });
      setArmed(null);
      setTone('ok');
      setMessage(`${show.name} was removed.`);
      await load();
    } catch (caught) {
      setTone('bad');
      setMessage(caught instanceof ApiError ? caught.message : 'Could not remove that show.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="fans-block">
      <h2>Shows</h2>
      <p>Shows already on the board. Open one to see its seats, or remove it.</p>
      {message ? <p className={tone === 'ok' ? 'success' : 'error'}>{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {shows == null && !error ? <p className="loading">Loading shows...</p> : null}
      {shows?.length === 0 ? <p>No shows yet.</p> : null}
      <ul className="fans">
        {shows?.map((show) => (
          <li key={show.id}>
            <div>
              <Link to={`/events/${show.id}`}>
                <strong>{show.name}</strong>
              </Link>
              <span>
                {show.seatCount} seats · {show.onSale ? 'On sale' : 'Not on sale yet'}
              </span>
            </div>
            {armed === show.id ? (
              <div className="actions">
                <button type="button" disabled={pending} onClick={() => void remove(show)}>
                  Confirm remove
                </button>
                <button type="button" className="text" disabled={pending} onClick={() => setArmed(null)}>
                  Keep
                </button>
              </div>
            ) : (
              <button type="button" className="text" disabled={pending} onClick={() => setArmed(show.id)}>
                Remove show
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Fans() {
  const { dropFan } = useFan();
  const [fans, setFans] = useState<FanAccount[] | null>(null);
  const [message, setMessage] = useState('');
  const [tone, setTone] = useState<'ok' | 'bad'>('ok');
  const [armed, setArmed] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    const next = await api<FanAccount[]>('/admin/users');
    setFans(next);
  }, []);

  useEffect(() => {
    void load().catch((caught) => {
      setTone('bad');
      setMessage(caught instanceof Error ? caught.message : 'Could not load fans.');
    });
  }, [load]);

  async function remove(username: string) {
    if (pending) return;
    setPending(true);
    setTone('ok');
    setMessage('');
    try {
      await api(`/admin/users/${encodeURIComponent(username)}`, { method: 'DELETE' });
      dropFan(username);
      setArmed(null);
      setTone('ok');
      setMessage(`${username} was deleted. Their seats are back on sale.`);
      await load();
    } catch (caught) {
      setTone('bad');
      setMessage(caught instanceof ApiError ? caught.message : 'Could not delete that fan.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="fans-block">
      <h2>Fans</h2>
      <p>Newest first. Deleting a fan releases their holds, removes their orders, and puts those seats back on sale.</p>
      {message ? <p className={tone === 'ok' ? 'success' : 'error'}>{message}</p> : null}
      {fans == null ? <p className="loading">Loading fans...</p> : null}
      {fans?.length === 0 ? <p>No fans have held a seat yet.</p> : null}
      <ul className="fans">
        {fans?.map((fan) => (
          <li key={fan.username}>
            <div>
              <strong>{fan.username}</strong>
              <span>
                {new Date(fan.createdAt).toLocaleString()} · {fan.holdCount} hold
                {fan.holdCount === 1 ? '' : 's'} · {fan.orderCount} order
                {fan.orderCount === 1 ? '' : 's'}
              </span>
            </div>
            {armed === fan.username ? (
              <div className="actions">
                <button type="button" disabled={pending} onClick={() => void remove(fan.username)}>
                  Confirm delete
                </button>
                <button type="button" className="text" disabled={pending} onClick={() => setArmed(null)}>
                  Keep
                </button>
              </div>
            ) : (
              <button type="button" className="text" disabled={pending} onClick={() => setArmed(fan.username)}>
                Delete User
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function indexToLabel(index: number): string {
  let n = index + 1;
  let label = '';
  while (n > 0) {
    label = String.fromCharCode(65 + ((n - 1) % 26)) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

function localInputToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}
