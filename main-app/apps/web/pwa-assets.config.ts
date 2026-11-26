import { defineConfig, minimal2023Preset } from "@vite-pwa/assets-generator/config"

// Generates the app icons from the logo: `pnpm --filter web pwa-assets` (rerun if the logo changes;
// the PNGs are committed). Maskable and Apple icons get a padded stall-yellow background.
export default defineConfig({
  headLinkOptions: { preset: "2023" },
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, resizeOptions: { background: "#fffaeb" } },
    apple: { ...minimal2023Preset.apple, resizeOptions: { background: "#fffaeb" } },
  },
  images: ["public/favicon.svg"],
})
