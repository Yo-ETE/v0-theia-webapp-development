import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'

// `variable` exposes each family as a CSS custom property that globals.css hands to
// --font-sans / --font-mono. Without it next/font emits a hashed family name that no
// stylesheet can reference, so the webfonts download but nothing ever uses them.
const geistSans = Geist({ subsets: ["latin"], variable: "--font-geist-sans", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: {
    default: "THEIA - Hub Control",
    template: "%s | THEIA",
  },
  description: 'IoT Surveillance Hub Control Interface',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/icon-192x192.jpg', sizes: '192x192', type: 'image/jpeg' },
      { url: '/icon-512x512.jpg', sizes: '512x512', type: 'image/jpeg' },
    ],
    apple: '/icon-192x192.jpg',
  },
  appleWebApp: {
    capable: true,
    title: 'THEIA',
    statusBarStyle: 'black-translucent',
  },
}

export const viewport: Viewport = {
  themeColor: "#1a1a2e",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="fr" className={`dark bg-background ${geistSans.variable} ${geistMono.variable}`}>
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
      </body>
    </html>
  )
}
