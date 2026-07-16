import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'prompt': a new deploy is DETECTED automatically (PwaUpdatePrompt polls
      // every 15 min + on refocus) but does NOT hijack the page. The new worker
      // WAITS; the "New version available" toast appears so a user finishes their
      // work first, and PwaUpdatePrompt also applies the waiting update quietly
      // when the tab goes hidden (so kiosks / TVs still self-heal, nobody is
      // stranded on a stale build). Previously 'autoUpdate' + skipWaiting force
      // reloaded the page mid-work and bypassed the toast entirely.
      registerType: 'prompt',
      injectRegister: 'auto',
      includeAssets: [
        'favicon.svg',
        'apple-touch-icon.png',
        'robots.txt',
        'browserconfig.xml',
        'offline.html',
        'icons/*.png',
      ],
      manifest: {
        id: '/?source=pwa',
        name: 'TyrePulse Fleet Intelligence',
        short_name: 'TyrePulse',
        description: 'Enterprise fleet tyre management and AI-powered intelligence platform',
        start_url: '/?source=pwa',
        scope: '/',
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone', 'minimal-ui'],
        background_color: '#0f172a',
        theme_color: '#1e3a5f',
        orientation: 'any',
        categories: ['business', 'fleet', 'management'],
        lang: 'en',
        dir: 'ltr',
        icons: [
          { src: '/icons/icon-72x72.png',            sizes: '72x72',   type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-96x96.png',            sizes: '96x96',   type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-128x128.png',          sizes: '128x128', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-144x144.png',          sizes: '144x144', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-152x152.png',          sizes: '152x152', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-192x192.png',          sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-384x384.png',          sizes: '384x384', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512x512.png',          sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-192x192-maskable.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/icon-512x512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/favicon.svg',                     sizes: 'any',     type: 'image/svg+xml', purpose: 'any' },
        ],
        shortcuts: [
          {
            name: 'Dashboard', short_name: 'Home',
            description: 'Fleet overview and KPI dashboard',
            url: '/?source=pwa-shortcut',
            icons: [{ src: '/icons/icon-96x96.png', sizes: '96x96' }],
          },
          {
            name: 'Tyre Records', short_name: 'Tyres',
            description: 'View and manage tyre records',
            url: '/tyres?source=pwa-shortcut',
            icons: [{ src: '/icons/icon-96x96.png', sizes: '96x96' }],
          },
          {
            name: 'Inspections', short_name: 'Inspect',
            description: 'Run and review tyre inspections',
            url: '/inspections?source=pwa-shortcut',
            icons: [{ src: '/icons/icon-96x96.png', sizes: '96x96' }],
          },
          {
            name: 'Alerts', short_name: 'Alerts',
            description: 'Active fleet alerts',
            url: '/alerts?source=pwa-shortcut',
            icons: [{ src: '/icons/icon-96x96.png', sizes: '96x96' }],
          },
        ],
        prefer_related_applications: false,
      },
      workbox: {
        // Allow large bundles — our app code exceeds the 2MB default
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2,ttf,eot,json,webmanifest}'],
        navigateFallback: 'index.html',
        // Deny API paths and non-HTML requests from navigate fallback
        navigateFallbackDenylist: [/^\/api\//, /^\/supabase\//],
        offlineGoogleAnalytics: false,
        cleanupOutdatedCaches: true,
        // prompt mode: the new SW must WAIT (do NOT skipWaiting) so the running
        // tab keeps its current build - and its already-loaded lazy chunks stay
        // served from the old precache - until the user (or the hidden-tab
        // auto-apply in PwaUpdatePrompt) chooses to activate it. This is what
        // stops the abrupt mid-work reload. clientsClaim stays so that once the
        // new SW DOES activate it controls the page immediately.
        skipWaiting: false,
        clientsClaim: true,
        runtimeCaching: [
          // SECURITY: authenticated Supabase traffic is NEVER cached in the
          // generic browser/SW cache. Previously /rest/ (data), /auth/, and
          // /storage/ (private signed-URL files) were cached here — that risks
          // one account seeing another's data after a device/account switch.
          // These now go straight to the network (no runtimeCaching entry), and
          // user-scoped app caches are cleared on logout (see AuthContext).
          // Only the app shell (precache), local icons, fonts, and the offline
          // write-queue below are cached.

          // Local icons / images — CacheFirst, 30 days
          {
            urlPattern: /\/icons\/.*\.png$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'app-icons-v1',
              expiration: { maxEntries: 30, maxAgeSeconds: 30 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Google Fonts — CacheFirst, 1 year
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-v1',
              expiration: { maxEntries: 20, maxAgeSeconds: 365 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Supabase REST POST (inspection saves) — Background Sync offline
          // QUEUE. This is a write queue (NetworkOnly), not a response cache: no
          // authenticated data is stored, only pending writes for replay.
          {
            urlPattern: ({ url, request }) =>
              url.hostname.includes('supabase.co') &&
              url.pathname.startsWith('/rest/') &&
              request.method === 'POST',
            handler: 'NetworkOnly',
            options: {
              backgroundSync: {
                name: 'inspection-sync',
                options: {
                  maxRetentionTime: 24 * 60, // 24 hours in minutes
                },
              },
            },
          },
        ],
      },
      // Disable SW in development to avoid interference with hot reload
      devOptions: {
        enabled: false,
      },
    }),
  ],

  build: {
    outDir: 'dist',
    sourcemap: false,
    // Raised from the 500 kB default only AFTER splitting the heavy vendor
    // groups (react / echarts / chart.js / supabase / motion / table) into
    // their own cacheable chunks. This is not the primary fix — the splitting
    // is — it just silences the warning for the remaining app-shell chunk.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // Chunk vendor libs for better caching.
        // IMPORTANT: No vendor-misc fallback — avoids circular chunk deps that crash
        // iOS Safari (JavaScriptCore TDZ error). React internals like /scheduler/,
        // /use-sync-external-store/, /object-assign/ must be co-located in vendor-react
        // since react-dom imports them; splitting them out creates vendor-misc →
        // vendor-react → vendor-misc cycles that V8 tolerates but JSC does not.
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (
            id.includes('/react/') ||
            id.includes('/react-dom/') ||
            id.includes('/react-router') ||
            id.includes('/scheduler/') ||
            id.includes('/object-assign/') ||
            id.includes('/use-sync-external-store/')
          ) return 'vendor-react'
          // chart.js + react-chartjs-2 wrapper.
          if (id.includes('/chart.js/') || id.includes('/react-chartjs')) return 'vendor-chartjs'
          // echarts is the heaviest single vendor (~1 MB) and was previously
          // buried inside the main index chunk. Split it out so it is cached
          // independently and only re-downloaded when echarts itself changes.
          if (id.includes('/echarts/') || id.includes('/echarts-for-react/') || id.includes('/zrender/')) return 'vendor-echarts'
          if (id.includes('/framer-motion/')) return 'vendor-motion'
          // NOTE: xlsx / jspdf / pptxgenjs are intentionally NOT pinned here.
          // They are only ever loaded via dynamic import(), so Rollup gives each
          // its own async chunk that downloads on the first export/parse click.
          // Pinning them into a manual chunk made Rollup co-locate shared interop
          // helpers there, dragging the whole ~400 KB chunk back into every
          // page's initial load.
          if (id.includes('/@supabase/')) return 'vendor-supabase'
          if (id.includes('/@anthropic-ai/')) return 'vendor-ai'
          if (id.includes('/lucide-react/')) return 'vendor-icons'
          // TanStack (table/query/virtual) — shared across data-grid pages.
          if (id.includes('/@tanstack/')) return 'vendor-table'
          // Remaining packages: Rollup assigns them automatically, no forced grouping
        },
      },
    },
  },

  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    // Heavy jsdom render tests (e.g. the workflow panels) can exceed the 5s
    // default under parallel CPU load — give them headroom to avoid flakiness.
    testTimeout: 20000,
    // services/** has its own Node (node:test) suite — keep it out of vitest.
    exclude: ['**/.claude/**', '**/node_modules/**', '**/dist/**', '**/services/**'],
    // Hermetic test env: modules that construct the Supabase client at import
    // time (src/lib/supabase.js) need the two public vars present. These are
    // dummy placeholders — no real project is contacted in unit tests. Only
    // the public URL/anon key are set, so supabase.js's secret-exposure guard
    // (which trips on privileged VITE_* secrets) stays satisfied.
    env: {
      VITE_SUPABASE_URL: 'https://test.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
    },
  },

  resolve: {
    alias: [
      { find: /.*\/agent-toolset\/fs-util\.mjs$/, replacement: path.resolve(__dirname, 'src/stubs/empty.js') },
      { find: /.*\/agent-toolset\/node\.mjs$/,    replacement: path.resolve(__dirname, 'src/stubs/empty.js') },
      { find: /.*\/agent-toolset\/skills\.mjs$/,  replacement: path.resolve(__dirname, 'src/stubs/empty.js') },
    ],
  },
})
