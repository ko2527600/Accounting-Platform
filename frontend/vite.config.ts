import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'AccountGo | Multi-Tenant ERP & Accounting Platform',
        short_name: 'AccountGo',
        description:
          'Multi-tenant accounting and ERP platform with double-entry bookkeeping, multi-warehouse inventory, invoicing, bank reconciliation, and instant SMS cash-shortage alerts.',
        theme_color: '#022c22',
        background_color: '#022c22',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache only the built static app shell (JS/CSS/HTML/icons) - the
        // plugin's default globPatterns. Financial data must never be served
        // from a cache, so /api/** is explicitly excluded from every caching
        // path: no runtimeCaching entry matches it, and navigation fallback
        // (used for client-side routing) never intercepts it either.
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
})
