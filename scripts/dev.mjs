// Arranca todo en local: la API (wrangler dev, con D1 local) y la web (Vite).
// Uso: npm run dev
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const devVars = path.join(root, 'worker/.dev.vars');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

// Secreto de desarrollo (no se sube al repositorio).
if (!fs.existsSync(devVars)) {
  fs.writeFileSync(devVars, `HASH_SECRET=${crypto.randomBytes(24).toString('hex')}\n`);
  console.log('Creado worker/.dev.vars con un secreto de desarrollo.');
}

const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' };
spawnSync(npx, ['wrangler', 'd1', 'migrations', 'apply', 'la-bola-negra', '--local', '--env', 'desarrollo', '--config', 'worker/wrangler.toml'], { cwd: root, stdio: 'inherit', env });

const procs = [
  spawn(npx, ['wrangler', 'dev', '--config', 'worker/wrangler.toml', '--env', 'desarrollo', '--port', '8787'], { cwd: root, stdio: 'inherit', env }),
  spawn(npx, ['vite'], { cwd: root, stdio: 'inherit', env }),
];

const stop = () => {
  for (const p of procs) p.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', (code) => code && stop());
