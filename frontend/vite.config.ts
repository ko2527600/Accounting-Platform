import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/react-router-dom')) {
            return 'react-vendor';
          }
          if (id.includes('node_modules/lucide-react')) {
            return 'icons';
          }
          if (id.includes('node_modules/cmdk')) {
            return 'command';
          }
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-') || id.includes('node_modules/victory')) {
            return 'charts';
          }
          if (id.includes('node_modules/docx') || id.includes('node_modules/xlsx') || id.includes('node_modules/exceljs') || id.includes('node_modules/file-saver')) {
            return 'export-libs';
          }
          if (id.includes('node_modules/@radix-ui')) {
            return 'radix-ui';
          }
          if (id.includes('node_modules/date-fns') || id.includes('node_modules/dayjs') || id.includes('node_modules/moment')) {
            return 'date-utils';
          }
          if (id.includes('node_modules/framer-motion') || id.includes('node_modules/@motionone')) {
            return 'animation';
          }
          if (id.includes('node_modules/zod') || id.includes('node_modules/react-hook-form') || id.includes('node_modules/@hookform')) {
            return 'forms';
          }
          if (id.includes('node_modules/axios') || id.includes('node_modules/@tanstack/react-query')) {
            return 'data-fetching';
          }
        },
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Ledgio Business Accounting Software | Multi-Tenant ERP & Accounting Platform',
        short_name: 'Ledgio',
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
