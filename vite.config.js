import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // three.js alone is ~500 kB; it loads in its own chunk after the page content.
    chunkSizeWarningLimit: 700,
  },
});
