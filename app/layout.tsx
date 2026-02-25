import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'

const _geist = Geist({ subsets: ["latin"] });
const _geistMono = Geist_Mono({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    default: "THEIA - Hub Control",
    template: "%s | THEIA",
  },
  description: 'IoT Surveillance Hub Control Interface',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  themeColor: "#1a1a2e",
  width: "device-width",
  initialScale: 1,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="fr" className="dark">
      <body className="font-sans antialiased">
        <script dangerouslySetInnerHTML={{ __html: `
          // Auto-reload on ChunkLoadError (stale cache after Pi rebuild)
          // Uses sessionStorage to prevent infinite reload loops
          window.addEventListener('error', function(e) {
            if (e.message && (e.message.includes('ChunkLoadError') || e.message.includes('Failed to load chunk') || e.message.includes('Loading chunk'))) {
              var key = 'chunk_reload_' + Date.now().toString().slice(0, -4);
              if (!sessionStorage.getItem(key)) {
                sessionStorage.setItem(key, '1');
                window.location.reload();
              }
            }
          });
          window.addEventListener('unhandledrejection', function(e) {
            var msg = e.reason && (e.reason.message || String(e.reason));
            if (msg && (msg.includes('ChunkLoadError') || msg.includes('Failed to load chunk') || msg.includes('Loading chunk'))) {
              var key = 'chunk_reload_' + Date.now().toString().slice(0, -4);
              if (!sessionStorage.getItem(key)) {
                sessionStorage.setItem(key, '1');
                window.location.reload();
              }
            }
          });
        `}} />
        {children}
        <Analytics />
      </body>
    </html>
  )
}
