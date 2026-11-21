import { useEffect, useRef, useState } from 'react';
import { remainingMs } from '../format';

export function Countdown({
  expiresAt,
  offset,
  onZero,
}: {
  expiresAt: string;
  offset: number;
  onZero?: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const fired = useRef(false);
  const left = remainingMs(expiresAt, offset, now);
  const done = left <= 0;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    fired.current = false;
  }, [expiresAt]);

  useEffect(() => {
    if (done && !fired.current) {
      fired.current = true;
      onZero?.();
    }
  }, [done, onZero]);

  const seconds = Math.max(0, Math.ceil(left / 1000));
  const text = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return <span className={seconds < 60 ? 'time amber' : 'time'}>{text}</span>;
}
