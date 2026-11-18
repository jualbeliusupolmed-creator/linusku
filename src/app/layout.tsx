import type { Metadata, Viewport } from 'next';
import './globals.css';
import PwaRegistration from '@/components/PwaRegistration';
import FrontendThemeShell from './frontend-theme';

export const metadata: Metadata = {
  title: 'LINUSKU — Live Tracker Bus Lintas USU',
  description:
    'Pantau posisi dan estimasi waktu tiba (ETA) Bus Lintas USU antar fakultas dan halte di Kampus USU Padang Bulan secara real-time.',
  applicationName: 'LINUSKU',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
  },
  appleWebApp: {
    capable: true,
    title: 'LINUSKU',
    statusBarStyle: 'black-translucent',
  },
};

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#0f6d39' },
    { media: '(prefers-color-scheme: dark)', color: '#0b3d2e' },
  ],
};

const themeInitScript = `
(function () {
  try {
    var key = 'linusku-theme';
    var theme = window.localStorage.getItem(key);
    if (theme !== 'light' && theme !== 'dark' && theme !== 'system') {
      theme = 'system';
    }
    document.documentElement.dataset.theme = theme;
  } catch (error) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" suppressHydrationWarning>
      <head>
        <script
          id="linusku-theme-init"
          dangerouslySetInnerHTML={{ __html: themeInitScript }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Chivo+Mono:wght@400;500;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">
        <PwaRegistration />
        <FrontendThemeShell>{children}</FrontendThemeShell>
      </body>
    </html>
  );
}
