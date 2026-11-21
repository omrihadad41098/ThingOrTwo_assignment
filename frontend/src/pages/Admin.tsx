import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { useFan } from '../fan';

type FanAccount = {
  username: string;
  createdAt: string;
  holdCount: number;
  orderCount: number;
};

export function Admin() {
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
    <section className="admin">
      <p className="eyebrow">No login, same as the API</p>
      <h1>Fans</h1>
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
    </section>
  );
}
