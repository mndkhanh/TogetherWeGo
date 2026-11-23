import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// The API is served under /v1 on the same origin as the web app:
// locally through this proxy, in AWS through CloudFront. No CORS needed.
const API_TARGET = process.env.API_TARGET ?? "http://localhost:3100"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/v1": { target: API_TARGET, xfwd: true },
    },
  },
})
