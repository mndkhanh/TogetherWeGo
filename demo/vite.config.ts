/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    port: 5180,
    // Like the Hosting rewrite in firebase.json: the SePay webhook lives on the app's own origin.
    proxy: {
      "/api/sepay-webhook": {
        target: "http://127.0.0.1:5001",
        rewrite: () => "/demo-togetherwego/asia-southeast1/sepayWebhook",
      },
    },
  },
  test: { environment: "node", testTimeout: 20_000 },
})
