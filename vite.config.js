import { defineConfig, loadEnv } from 'vite';

/**
 * Variables de compilación (en GitHub Actions vienen de las variables del repositorio):
 *   VITE_API_URL   URL pública del Worker, p. ej. https://la-bola-negra-api.tu-cuenta.workers.dev
 *   VITE_SITE_URL  URL pública de la web, p. ej. https://marodseg.github.io/la-bola-negra
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const apiOrigin = env.VITE_API_URL ? new URL(env.VITE_API_URL).origin : '';
  const siteUrl = (env.VITE_SITE_URL || '').replace(/\/$/, '');

  const csp = [
    "default-src 'self'",
    "script-src 'self' https://challenges.cloudflare.com",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${apiOrigin} https://challenges.cloudflare.com`.trim(),
    'frame-src https://challenges.cloudflare.com',
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    ...(apiOrigin.startsWith('https:') ? ['upgrade-insecure-requests'] : []),
  ].join('; ');

  return {
    root: 'web',
    base: './',
    publicDir: 'public',
    build: {
      outDir: '../dist',
      emptyOutDir: true,
      target: 'es2022',
      // La urna 3D (Three.js + física) va en su propio fichero y se carga después de pintar la página.
      chunkSizeWarningLimit: 800,
      // Nada en línea como data: (la CSP solo permite recursos de la propia web).
      assetsInlineLimit: 0,
      rollupOptions: {
        input: {
          index: 'web/index.html',
          historico: 'web/historico.html',
          privacidad: 'web/privacidad.html',
          404: 'web/404.html',
        },
      },
    },
    server: {
      port: 5173,
      // En desarrollo, /api va al Worker local (wrangler dev).
      proxy: { '/api': 'http://127.0.0.1:8787' },
    },
    preview: { port: 4173, proxy: { '/api': 'http://127.0.0.1:8787' } },
    plugins: [{
      name: 'la-bola-negra-html',
      transformIndexHtml: {
        order: 'pre',
        handler(html, ctx) {
          // Sin VITE_SITE_URL no hay URL absoluta para canonical/og: se quitan esas etiquetas.
          let out = siteUrl
            ? html.replaceAll('%SITE_URL%', siteUrl)
            : html.split('\n').filter((line) => !line.includes('%SITE_URL%')).join('\n');
          // La CSP solo en producción: en desarrollo Vite inyecta estilos y scripts en línea.
          if (!ctx.server) {
            out = out.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n  <meta http-equiv="Content-Security-Policy" content="${csp}">`);
          }
          return out;
        },
      },
    }],
  };
});
