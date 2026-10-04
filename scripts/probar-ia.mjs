// Prueba la generación de preguntas con el modelo real de Workers AI, con los mismos filtros que la API.
// Uso: CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node scripts/probar-ia.mjs
// El token necesita el permiso «Account · Workers AI · Read».
import fs from 'node:fs';
import path from 'node:path';
import { generateWithAI } from '../worker/src/questions/ai.js';

const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account } = process.env;
if (!token || !account) {
  console.error('Faltan CLOUDFLARE_API_TOKEN y CLOUDFLARE_ACCOUNT_ID.');
  process.exit(1);
}

const toml = fs.readFileSync(path.resolve(import.meta.dirname, '../worker/wrangler.toml'), 'utf8');
const model = process.env.AI_MODEL || toml.match(/^AI_MODEL\s*=\s*"([^"]+)"/m)?.[1];
const { banco } = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../worker/src/questions/banco.json'), 'utf8'));

// Imita el binding env.AI del Worker usando la API REST de Cloudflare.
const AI = {
  async run(name, input) {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${name}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(`HTTP ${res.status}: ${JSON.stringify(data.errors ?? data)}`);
    return data.result;
  },
};

const log = { warn: (m) => console.log(`  · ${m}`) };
const recent = [...banco];
let ok = 0;
const rondas = Number(process.env.RONDAS ?? 3);
console.log(`Modelo: ${model}\n`);
for (let i = 1; i <= rondas; i++) {
  const q = await generateWithAI({ AI, AI_MODEL: model }, recent, { attempts: 3, log });
  if (q) {
    ok++;
    recent.unshift(q);
    console.log(`✔ ${i}. [${q.category}] ${q.text}`);
  } else {
    console.log(`✘ ${i}. Ninguna propuesta pasó los filtros en 3 intentos.`);
  }
}
console.log(`\n${ok} de ${rondas} rondas con pregunta válida.`);
process.exit(ok > 0 ? 0 : 1);
