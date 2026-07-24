import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import './globals.css';

export const metadata: Metadata = {
  title: 'MedRemind — Protocol & Adherence Tracker',
  description: 'Manage your medication protocols, track adherence, and never miss a dose.',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'MedRemind' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0e1013' },
    { media: '(prefers-color-scheme: light)', color: '#f7f5f0' },
  ],
};

const THEME_BOOTSTRAP = `
(function(){
  try {
    var stored = localStorage.getItem('theme');
    var theme = (stored === 'light' || stored === 'dark')
      ? stored
      : (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script id="theme-bootstrap" strategy="beforeInteractive">{THEME_BOOTSTRAP}</Script>
      </head>
      <body>{children}</body>
    </html>
  );
}
