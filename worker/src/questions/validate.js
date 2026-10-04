// Filtros para que ninguna pregunta (sobre todo las que propone la IA) se cuele si no cumple.

export const CATEGORIES = [
  'Sociedad', 'Vida', 'Ciudad', 'Trabajo', 'Tecnología', 'Gastronomía', 'Cultura', 'Deporte', 'Educación',
  'Salud', 'Economía', 'Vivienda', 'Transporte', 'Turismo', 'Energía', 'Medio ambiente', 'Tradiciones', 'Política',
];

// Temas que no queremos en una pregunta generada automáticamente.
const BLOCKED = [
  // partidos y políticos concretos
  'psoe', 'pp', 'vox', 'podemos', 'sumar', 'junts', 'erc', 'bildu', 'pnv', 'ciudadanos',
  'sanchez', 'feijoo', 'abascal', 'ayuso', 'puigdemont', 'yolanda', 'iglesias', 'rajoy', 'aznar', 'zapatero', 'franco',
  'franquismo', 'monarquia', 'rey', 'reina', 'republica', 'independencia', 'referendum',
  // religión
  'dios', 'ala', 'islam', 'musulman', 'judio', 'catolico', 'iglesia', 'religion', 'religiosa',
  // violencia, sexo, tragedias, colectivos
  'matar', 'muerte', 'morir', 'suicidio', 'violacion', 'violencia', 'terrorismo', 'terrorista', 'eta', 'arma', 'armas',
  'aborto', 'eutanasia', 'sexo', 'sexual', 'porno', 'droga', 'drogas', 'inmigrante', 'inmigrantes', 'inmigracion',
  'raza', 'etnia', 'gitano', 'gitanos', 'gay', 'gays', 'lgtbi', 'trans', 'feminismo', 'machismo',
];

const STOPWORDS = new Set([
  'debería', 'deberia', 'deberían', 'deberian', 'sería', 'seria', 'para', 'como', 'todos', 'todas', 'esta', 'este',
  'estos', 'estas', 'más', 'mas', 'menos', 'sobre', 'entre', 'tener', 'hacer', 'cada', 'día', 'dia', 'años',
]);

/** Minúsculas, sin tildes ni signos. */
export function normalize(text) {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function keywords(text) {
  return new Set(normalize(text).split(' ').filter((w) => w.length > 3 && !STOPWORDS.has(w)));
}

/** Parecido entre dos preguntas (0..1) por palabras clave compartidas. */
export function similarity(a, b) {
  const ka = keywords(a);
  const kb = keywords(b);
  if (!ka.size || !kb.size) return 0;
  let common = 0;
  for (const w of ka) if (kb.has(w)) common++;
  return common / (ka.size + kb.size - common);
}

/**
 * @param {{ text?: unknown, category?: unknown }} q
 * @param {string[]} recent  preguntas ya publicadas
 * @returns {{ ok: true, question: { text: string, category: string } } | { ok: false, reason: string }}
 */
export function validateQuestion(q, recent = []) {
  if (!q || typeof q.text !== 'string') return { ok: false, reason: 'sin texto' };
  const text = q.text.replace(/\s+/g, ' ').trim();
  if (!text.startsWith('¿') || !text.endsWith('?')) return { ok: false, reason: 'no es una pregunta' };
  if ((text.match(/[¿?]/g) ?? []).length !== 2) return { ok: false, reason: 'más de una pregunta' };
  if (text.length < 25 || text.length > 130) return { ok: false, reason: 'longitud' };
  if (/[<>{}[\]\\|@#*_~`$^=]|https?:|www\./i.test(text)) return { ok: false, reason: 'caracteres no permitidos' };
  if (/[A-ZÁÉÍÓÚÑ]{4,}/.test(text)) return { ok: false, reason: 'mayúsculas' };

  const words = new Set(normalize(text).split(' '));
  const hit = BLOCKED.find((w) => words.has(w));
  if (hit) return { ok: false, reason: `tema vetado (${hit})` };

  const category = CATEGORIES.find((c) => normalize(c) === normalize(String(q.category ?? '')));
  if (!category) return { ok: false, reason: 'categoría' };

  for (const prev of recent) {
    if (normalize(prev) === normalize(text) || similarity(prev, text) >= 0.5) {
      return { ok: false, reason: 'repetida' };
    }
  }
  return { ok: true, question: { text, category } };
}
