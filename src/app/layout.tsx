import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { DataProvider } from '@/context/DataContext';

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  // 800 was loaded but is no longer used: headings get their weight from size
  // and tracking rather than from stacking bold on bold.
  weight: ['400', '500', '600', '700'],
  variable: '--font-jakarta',
  display: 'swap',
});

/**
 * Used for task ids and timestamps, where a fixed advance width stops values
 * jittering between rows. Self-hosted by next/font, so it costs no extra
 * network round trip at runtime.
 */
const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono-face',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Marketing Tasks | Marketing Dashboard',
  description:
    'Plan, track and approve marketing work, synchronised with Google Sheets.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The theme colour follows the canvas token in each mode so the mobile
  // browser chrome matches the app instead of flashing white.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f7f9' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0f18' },
  ],
};

/**
 * Applies the theme before first paint.
 *
 * The previous build read the theme in a `useEffect`, which runs after
 * hydration — so anyone using dark mode got a white flash on every single page
 * load. This runs synchronously in the head, before the browser paints.
 *
 * It also honours the system preference, which was ignored entirely before:
 * everyone was defaulted to light regardless of their OS setting.
 */
const themeScript = `
(function () {
  try {
    var stored = localStorage.getItem('mtd-theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var dark = stored ? stored === 'dark' : prefersDark;
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {
    /* Private mode can throw on localStorage; light is a safe fallback. */
  }
})();
`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning: the script above mutates the class list before
    // React hydrates, so the server and client markup differ here by design.
    <html
      lang="en"
      className={`${jakarta.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="bg-canvas text-fg min-h-screen">
        <DataProvider>{children}</DataProvider>
      </body>
    </html>
  );
}
