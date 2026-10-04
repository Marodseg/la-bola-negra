import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from './src/app.js';
import { openDb } from './src/db.js';
import { loadQuestions } from './src/questions.js';

const root = import.meta.dirname;
const dataDir = process.env.BN_DATA_DIR ?? path.join(root, 'data');
fs.mkdirSync(dataDir, { recursive: true });

// Secreto para firmar cookies: de la variable de entorno o generado una vez y guardado en disco.
function loadSecret() {
  if (process.env.BN_SECRET) return process.env.BN_SECRET;
  const file = path.join(dataDir, '.secret');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(file, 'utf8').trim();
}

const db = openDb(path.join(dataDir, 'bolanegra.db'));
const questions = loadQuestions(process.env.BN_QUESTIONS ?? path.join(root, 'questions.json'));

const app = createApp({
  db,
  questions,
  secret: loadSecret(),
  maxVotesPerIp: Number(process.env.BN_MAX_VOTOS_POR_IP ?? 5),
  // Detrás de un proxy (Render, Fly, nginx...) pon TRUST_PROXY=1 para leer la IP real.
  trustProxy: process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY : false,
});

const port = Number(process.env.PORT ?? 3000);
const server = app.listen(port, () => {
  console.log(`⚫ La Bola Negra escuchando en http://localhost:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
}
