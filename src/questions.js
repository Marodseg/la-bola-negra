import fs from 'node:fs';
import { addDays, daysBetween } from './time.js';

/**
 * Las preguntas viven en questions.json:
 *  - "start": el día de la pregunta nº 1.
 *  - "fixed": preguntas fijadas a un día concreto ({ "2026-12-25": { "text": "...", "tag": "..." } }).
 *  - "pool": el resto; se recorren en orden, una por día, y vuelven a empezar al acabar.
 */
export function loadQuestions(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(data.pool) || data.pool.length === 0) {
    throw new Error('questions.json necesita al menos una pregunta en "pool"');
  }
  const start = data.start;
  const fixed = data.fixed ?? {};
  const pool = data.pool;

  function questionFor(day) {
    const offset = daysBetween(start, day);
    if (offset < 0) return null;
    const q = fixed[day] ?? pool[offset % pool.length];
    return { day, number: offset + 1, text: q.text, tag: q.tag ?? null };
  }

  /** Días anteriores a `today` (el más reciente primero), sin pasar del día de inicio. */
  function pastDays(today, limit) {
    const days = [];
    for (let d = addDays(today, -1); days.length < limit && daysBetween(start, d) >= 0; d = addDays(d, -1)) {
      days.push(d);
    }
    return days;
  }

  return { start, questionFor, pastDays };
}
