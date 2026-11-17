import type { Metadata } from 'next';
import './globals.css';
import PwaRegistration from '@/components/PwaRegistration';

export const metadata: Metadata = {
  title: 'LINUSKU — Live Tracker Bus Lintas USU',
  description:
    'Pantau posisi dan estimasi waktu tiba (ETA) Bus Lintas USU antar fakultas dan halte di Kampus USU Padang Bulan secara real-time.',
  manifest: '/manifest.webmanifest',
};

export const viewport = {
  themeColor: '#0f6d39',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Chivo+Mono:wght@400;500;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">
        <PwaRegistration />
        {children}
      </body>
    </html>
  );
}
