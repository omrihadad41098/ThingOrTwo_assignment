import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

const ACTIVE = 'fan';
const RECENT = 'seatrush.recent';

type FanContextValue = {
  fan: string;
  signIn: (name: string) => void;
  switchFan: () => void;
  dropFan: (username: string) => void;
};

const FanContext = createContext<FanContextValue | null>(null);

export function FanProvider({ children }: { children: ReactNode }) {
  const [fan, setFan] = useState(() => sessionStorage.getItem(ACTIVE) ?? '');

  const value = useMemo<FanContextValue>(
    () => ({
      fan,
      signIn(name: string) {
        const username = name.trim().toLowerCase();
        sessionStorage.setItem(ACTIVE, username);
        setFan(username);
      },
      switchFan() {
        sessionStorage.removeItem(ACTIVE);
        setFan('');
      },
      dropFan(username: string) {
        const next = readRecent().filter((item) => item !== username);
        localStorage.setItem(RECENT, JSON.stringify(next));
        setFan((current) => {
          if (current !== username) return current;
          sessionStorage.removeItem(ACTIVE);
          return '';
        });
      },
    }),
    [fan],
  );

  return <FanContext.Provider value={value}>{children}</FanContext.Provider>;
}

export function useFan(): FanContextValue {
  const value = useContext(FanContext);
  if (!value) throw new Error('FanProvider is missing');
  return value;
}

export function keepKnownFans(existing: string[]): void {
  const allowed = new Set(existing);
  const next = readRecent().filter((item) => allowed.has(item));
  localStorage.setItem(RECENT, JSON.stringify(next));
}

function readRecent(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT) ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}
