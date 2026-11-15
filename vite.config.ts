import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    base: './',
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: [
          'favicon.svg',
          'apple-touch-icon.png',
          'assets/logo.png',
          'assets/favicon-32.png',
        ],
        manifest: {
          id: './',
          name: 'ObsidIAn Navigator',
          short_name: 'ObsidIAn',
          description:
            'Visor orbital 2D/3D del cráter Jezero con fuente NASA integrada, planificador de rutas y simulación de rover marciano.',
          theme_color: '#0b1119',
          background_color: '#080e15',
          display: 'standalone',
          start_url: './',
          scope: './',
          icons: [
            {
              src: './pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: './pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: './pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,jpg,svg,json,woff,woff2}'],
          globIgnores: ['**/*.zip'],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          runtimeCaching: [
            // La comprobación de conexión con NASA Trek nunca debe servirse desde caché.
            { urlPattern: /[?&]probe=/, handler: 'NetworkOnly' },
            {
              urlPattern: /^https:\/\/trek\.nasa\.gov\/tiles\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'nasa-trek-runtime-cache',
                expiration: {
                  maxEntries: 1500,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/astro\.arcgis\.com\/arcgis\/rest\/services\/OnMars\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'nasa-onmars-runtime-cache',
                expiration: {
                  maxEntries: 1500,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: true,
          type: 'module',
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
