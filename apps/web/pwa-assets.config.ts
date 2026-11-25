import { defineConfig, minimal2023Preset } from "@vite-pwa/assets-generator/config"

// Generates the app icons from the logo: `pnpm --filter web pwa-assets` (rerun if the logo changes;
// the PNGs are committed). Maskable and Apple icons get a padded white background.
export default defineConfig({
  headLinkOptions: { preset: "2023" },
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, resizeOptions: { background: "#ffffff" } },
    apple: { ...minimal2023Preset.apple, resizeOptions: { background: "#ffffff" } },
  },
  images: ["public/favicon.svg"],
})
