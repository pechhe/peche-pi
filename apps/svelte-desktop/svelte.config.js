import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      pages: "dist",
      assets: "dist",
      fallback: "index.html",
      precompress: false,
      strict: true,
    }),
    // No SSR server in production — static SPA loaded by Tauri
    output: {
      bundleStrategy: "single",
    },
    prerender: {
      entries: ["/"],
    },
  },
};

export default config;
