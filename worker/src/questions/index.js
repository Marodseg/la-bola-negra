import data from './banco.json' with { type: 'json' };
import { generateWithAI } from './ai.js';
import { normalize } from './validate.js';

/** Preguntas fijadas a una fecha (Navidad, Nochevieja...). */
export const EDITORIAL = data.editorial;
/** Banco de preguntas escritas a mano, se usan en orden. */
export const BANK = data.banco;

const SELECT_QUESTION = 'SELECT day, number, text, category, source FROM questions WHERE day = ?';

export async function getQuestion(db, day) {
  return db.prepare(SELECT_QUESTION).bind(day).first();
}

/**
 * Elige la pregunta de un día:
 *   1. editorial fijada para esa fecha
 *   2. la siguiente del banco que no se haya usado (o la IA primero, si PREFER_AI)
 *   3. una nueva propuesta por la IA (solo si `allowAI`)
 *   4. la del banco que hace más tiempo que salió
 * Así nunca se queda un día sin pregunta.
 */
export async function chooseQuestion(env, day, { allowAI = false, log = console } = {}) {
  if (EDITORIAL[day]) return { ...EDITORIAL[day], source: 'editorial' };

  const { results: used } = await env.DB.prepare('SELECT day, text FROM questions ORDER BY day DESC').all();
  const usedSet = new Set(used.map((q) => normalize(q.text)));
  const fresh = BANK.find((q) => !usedSet.has(normalize(q.text)));
  const preferAI = String(env.PREFER_AI) === 'true';

  if (fresh && !(allowAI && preferAI)) return { ...fresh, source: 'banco' };
  if (allowAI) {
    const generated = await generateWithAI(env, used.map((q) => q.text), { log });
    if (generated) return { ...generated, source: 'ia' };
  }
  if (fresh) return { ...fresh, source: 'banco' };

  // Banco agotado y sin IA: la que lleva más tiempo sin salir.
  const lastUse = new Map();
  for (const q of used) {
    const key = normalize(q.text);
    if (!lastUse.has(key)) lastUse.set(key, q.day);
  }
  const oldest = [...BANK].sort((a, b) => (lastUse.get(normalize(a.text)) ?? '').localeCompare(lastUse.get(normalize(b.text)) ?? ''))[0];
  return { ...oldest, source: 'reciclada' };
}

/** Devuelve la pregunta del día; si no existe todavía, la elige y la guarda. */
export async function ensureQuestion(env, day, opts = {}) {
  const existing = await getQuestion(env.DB, day);
  if (existing) return existing;
  const q = await chooseQuestion(env, day, opts);
  // INSERT OR IGNORE: si dos peticiones llegan a la vez, solo una gana y ambas leen la misma.
  // Se reintenta por si otra inserción simultánea (de otro día) se quedó antes con el número.
  for (let attempt = 0; attempt < 3; attempt++) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO questions (day, number, text, category, source, created_at)
       SELECT ?, COALESCE(MAX(number), 0) + 1, ?, ?, ?, ? FROM questions`,
    ).bind(day, q.text, q.category ?? null, q.source, Date.now()).run();
    const saved = await getQuestion(env.DB, day);
    if (saved) return saved;
  }
  throw new Error(`No se pudo guardar la pregunta del ${day}`);
}
