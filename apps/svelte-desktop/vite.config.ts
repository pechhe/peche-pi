import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    port: 5174,
    strictPort: false,
  },
  // Prevent Vite from obscuring Rust errors
  clearScreen: false,
});
