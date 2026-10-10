import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// /admin is a separate page; in development serve it at /admin too, as Vercel does with cleanUrls
const adminRoute = {
  name: 'admin-route',
  configureServer(server){
    server.middlewares.use((req, _res, next) => { if (req.url === '/admin' || req.url === '/admin/') req.url = '/admin.html'; next(); });
  },
};

// Share cards need absolute URLs. On Vercel the build knows the project's production domain;
// locally it falls back to localhost. __SITE_URL__ in the HTML is replaced with it.
const siteUrl = {
  name: 'site-url',
  transformIndexHtml: {
    order: 'pre',
    handler(html){
      const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
      return html.replaceAll('__SITE_URL__', host ? `https://${host}` : 'http://localhost:5173');
    },
  },
};

export default defineConfig({
  plugins: [adminRoute, siteUrl],
  build: {
    // three.js alone is ~500 kB; it loads in its own chunk after the page content.
    chunkSizeWarningLimit: 700,
    rollupOptions: { input: { main: resolve(__dirname, 'index.html'), admin: resolve(__dirname, 'admin.html'), notfound: resolve(__dirname, '404.html') } },
  },
});
