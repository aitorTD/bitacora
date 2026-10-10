import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// /admin is a separate page; in development serve it at /admin too, as Vercel does with cleanUrls
const adminRoute = {
  name: 'admin-route',
  configureServer(server){
    server.middlewares.use((req, _res, next) => { if (req.url === '/admin' || req.url === '/admin/') req.url = '/admin.html'; next(); });
  },
};

// Share cards need absolute URLs: the official address in production builds, the deployment's own
// address on previews, localhost locally. __SITE_URL__ in the HTML is replaced with it.
const SITE = 'https://bitacora-aitor.vercel.app';
const siteUrl = {
  name: 'site-url',
  transformIndexHtml: {
    order: 'pre',
    handler(html){
      const url = process.env.VERCEL_ENV === 'production' ? SITE : process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:5173';
      return html.replaceAll('__SITE_URL__', url);
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
