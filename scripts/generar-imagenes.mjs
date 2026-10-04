// Genera las imágenes estáticas de la web (tarjeta para redes e iconos) con Playwright.
// Uso: node scripts/generar-imagenes.mjs   (requiere `npx playwright install chromium` la primera vez)
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright').catch(() => {
  console.error('Instala Playwright primero: npm i -D playwright && npx playwright install chromium');
  process.exit(1);
});

const root = path.resolve(import.meta.dirname, '..');
const out = (f) => path.join(root, 'web/public', f);
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

const og = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await og.goto(pathToFileURL(path.join(root, 'scripts/og.html')).href);
await og.evaluate('document.fonts.ready');
await og.screenshot({ path: out('og.png') });

for (const size of [180, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.goto(pathToFileURL(out('favicon.svg')).href);
  await page.screenshot({ path: out(size === 180 ? 'apple-touch-icon.png' : 'icon-512.png'), omitBackground: true });
}

await browser.close();
console.log('Imágenes generadas en web/public/');
