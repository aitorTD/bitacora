import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// /admin is a separate page; in development serve it at /admin too, as Vercel does with cleanUrls
const adminRoute = {
  name: 'admin-route',
  configureServer(server){
    server.middlewares.use((req, _res, next) => { if (req.url === '/admin' || req.url === '/admin/') req.url = '/admin.html'; next(); });
  },
};

export default defineConfig({
  plugins: [adminRoute],
  build: {
    // three.js alone is ~500 kB; it loads in its own chunk after the page content.
    chunkSizeWarningLimit: 700,
    rollupOptions: { input: { main: resolve(__dirname, 'index.html'), admin: resolve(__dirname, 'admin.html') } },
  },
});
