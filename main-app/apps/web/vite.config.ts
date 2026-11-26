import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { VitePWA } from "vite-plugin-pwa"

// The API is served under /v1 on the same origin as the web app:
// locally through this proxy, in AWS through CloudFront. No CORS needed.
const API_TARGET = process.env.API_TARGET ?? "http://localhost:3100"

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Installable app. The service worker only caches the app itself (HTML, JS, CSS, fonts,
    // icons) so it opens instantly and offline. It never touches /v1: money, balances and
    // anything personal always come fresh from the API, and nothing private sits in the cache.
    VitePWA({
      // A new version waits until the person chooses to reload (see pwa-update.tsx), so a
      // form they're halfway through is never thrown away.
      registerType: "prompt",
      injectRegister: false,
      manifest: {
        name: "TogetherWeGo",
        short_name: "TogetherWeGo",
        description: "Plan hangouts with friends, split costs and settle up.",
        lang: "en",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#fffaeb",
        theme_color: "#c2352a",
        icons: [
          { src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "maskable-icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        navigateFallback: "/index.html",
        // Deep links work offline, but API calls (and the realtime socket) never get the shell.
        navigateFallbackDenylist: [/^\/v1\//],
        cleanupOutdatedCaches: true,
        // No runtimeCaching on purpose: receipts (pre-signed S3 URLs), QR codes and API
        // responses go straight to the network.
      },
    }),
  ],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // ws: the realtime notifications socket lives under /v1/realtime.
      "/v1": { target: API_TARGET, xfwd: true, ws: true },
    },
  },
})
