import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { keepKnownFans, useFan } from '../fan';

const NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export function Login() {
  const { fan, signIn, dropFan } = useFan();
  const navigate = useNavigate();
  const [name, setName] = useState(fan);
  const [error, setError] = useState('');
  const [known, setKnown] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    api<{ username: string }[]>('/admin/users')
      .then((rows) => {
        if (cancelled) return;
        const names = rows.map((row) => row.username);
        keepKnownFans(names);
        setKnown(names);
        if (fan && !names.includes(fan)) {
          dropFan(fan);
          setName((current) => (current.trim().toLowerCase() === fan ? '' : current));
        }
      })
      .catch(() => {
        if (!cancelled) setKnown([]);
      });
    return () => {
      cancelled = true;
    };
  }, [dropFan, fan]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const username = name.trim().toLowerCase();
    if (!NAME.test(username)) {
      setError('Use letters, numbers, underscores, or hyphens, up to 32 characters.');
      return;
    }
    signIn(username);
    navigate('/events');
  }

  return (
    <section className="gate">
      <p className="eyebrow">The doors are open</p>
      <h1>What should we call you?</h1>
      <p className="lede">
        Two browser windows can be two fans. This name stays in this tab only, and there is no password.
      </p>
      <form onSubmit={submit}>
        <label htmlFor="fan-name">Name</label>
        <input
          id="fan-name"
          autoFocus
          autoComplete="off"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="ada"
        />
        {error ? <p className="error">{error}</p> : null}
        <button type="submit">Take me in</button>
      </form>
      {known.length ? (
        <div className="recent">
          {known.map((item) => (
            <button key={item} type="button" className="chip" onClick={() => setName(item)}>
              {item}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
