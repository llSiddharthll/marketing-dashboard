'use client';

/**
 * Theme state.
 *
 * The class is applied before paint by the inline script in the root layout;
 * this context only reads what that script already decided and handles later
 * toggles. Keeping the two in step means the storage key lives in one place.
 *
 * Supports an explicit "system" choice, so someone can hand control back to
 * their OS rather than being stuck on whichever mode they last picked.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';

/** Must match the key used by the inline script in `layout.tsx`. */
const STORAGE_KEY = 'mtd-theme';

interface ThemeContextValue {
  /** What the user chose. */
  preference: ThemePreference;
  /** What is actually on screen once "system" is resolved. */
  resolved: 'light' | 'dark';
  setPreference: (preference: ThemePreference) => void;
  /** Cycles light → dark → light, for the header toggle. */
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function readStoredPreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* Private mode; fall back to following the system. */
  }
  return 'system';
}

function applyToDocument(dark: boolean): void {
  document.documentElement.classList.toggle('dark', dark);
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  // Lazy initializers rather than an effect: the value is only wrong for one
  // render on the server (where it falls back to 'system'/'light', matching
  // what the inline layout script already painted), and reading it here avoids
  // a setState-in-effect that would cause an extra render on every mount.
  const [preference, setPreferenceState] = useState<ThemePreference>(
    readStoredPreference
  );
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  // Follow the OS live, so a machine that switches at sunset switches the app
  // too — but only while the user has not overridden it.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');

    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const resolved: 'light' | 'dark' =
    preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;

  useEffect(() => {
    applyToDocument(resolved === 'dark');
  }, [resolved]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    try {
      // 'system' is stored as an absence, which is exactly what the inline
      // script treats as "ask the OS".
      if (next === 'system') window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* Non-fatal: the choice just will not survive a reload. */
    }
  }, []);

  const toggle = useCallback(() => {
    setPreference(resolved === 'dark' ? 'light' : 'dark');
  }, [resolved, setPreference]);

  const value = useMemo(
    () => ({ preference, resolved, setPreference, toggle }),
    [preference, resolved, setPreference, toggle]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
