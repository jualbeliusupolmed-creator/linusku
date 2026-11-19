'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Moon, Sun } from 'lucide-react';

type ThemePreference = 'system' | 'light' | 'dark';

type FrontendThemeShellProps = {
  children: ReactNode;
};

const THEME_STORAGE_KEY = 'linusku-theme';
const LIGHT_THEME_COLOR = '#0f6d39';
const DARK_THEME_COLOR = '#0b3d2e';

const themeLabels: Record<ThemePreference, string> = {
  system: 'sistem',
  light: 'terang',
  dark: 'gelap',
};

function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

function resolveTheme(theme: ThemePreference): 'light' | 'dark' {
  if (theme !== 'system') return theme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme: ThemePreference) {
  document.documentElement.dataset.theme = theme;
  const resolvedTheme = resolveTheme(theme);
  document
    .querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
    .forEach((meta) => {
      meta.content =
        resolvedTheme === 'dark' ? DARK_THEME_COLOR : LIGHT_THEME_COLOR;
    });
}

export default function FrontendThemeShell({
  children,
}: FrontendThemeShellProps) {
  const pathname = usePathname();
  const [theme, setTheme] = useState<ThemePreference>('system');
  const [announcement, setAnnouncement] = useState('');
  const [mainTarget, setMainTarget] = useState('main-content');
  const isDriverRoute = pathname === '/driver';
  const resolvedTheme =
    theme === 'system'
      ? typeof window !== 'undefined' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme;

  useEffect(() => {
    let storedTheme: string | null = null;
    try {
      storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    } catch {
      storedTheme = null;
    }

    const initialTheme = isThemePreference(storedTheme) ? storedTheme : 'system';
    setTheme(initialTheme);
    applyTheme(initialTheme);

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemChange = () => {
      setTheme((currentTheme) => {
        applyTheme(currentTheme);
        return currentTheme;
      });
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      const nextTheme = isThemePreference(event.newValue) ? event.newValue : 'system';
      setTheme(nextTheme);
      applyTheme(nextTheme);
      setAnnouncement(`Tema ${themeLabels[nextTheme]} dipilih.`);
    };

    mediaQuery.addEventListener('change', handleSystemChange);
    window.addEventListener('storage', handleStorage);
    return () => {
      mediaQuery.removeEventListener('change', handleSystemChange);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  useEffect(() => {
    const main = document.querySelector('main');
    if (!main) return;
    if (main.id) {
      setMainTarget(main.id);
    } else {
      main.id = 'main-content';
      setMainTarget('main-content');
    }
    main.tabIndex = -1;
  }, [pathname]);

  const handleThemeChange = (nextTheme: ThemePreference) => {
    setTheme(nextTheme);
    applyTheme(nextTheme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      setAnnouncement('Preferensi tema tidak dapat disimpan di perangkat ini.');
      return;
    }
    setAnnouncement(`Tema ${themeLabels[nextTheme]} dipilih.`);
  };

  return (
    <>
      <a className="skip-link" href={`#${mainTarget}`}>
        Lewati ke konten utama
      </a>
      <div
        className="frontend-root"
        id={isDriverRoute ? 'main-content' : undefined}
        role={isDriverRoute ? 'main' : undefined}
        tabIndex={isDriverRoute ? -1 : undefined}
      >
        {children}
      </div>
      <div className="theme-control">
        <button
          type="button"
          className={resolvedTheme === 'light' ? 'is-active' : ''}
          aria-label="Aktifkan mode terang"
          aria-pressed={resolvedTheme === 'light'}
          onClick={() => handleThemeChange('light')}
        >
          <Sun size={16} aria-hidden="true" />
          <span>Terang</span>
        </button>
        <button
          type="button"
          className={resolvedTheme === 'dark' ? 'is-active' : ''}
          aria-label="Aktifkan mode gelap"
          aria-pressed={resolvedTheme === 'dark'}
          onClick={() => handleThemeChange('dark')}
        >
          <Moon size={16} aria-hidden="true" />
          <span>Gelap</span>
        </button>
      </div>
      <span
        className="visually-hidden"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {announcement}
      </span>
    </>
  );
}
