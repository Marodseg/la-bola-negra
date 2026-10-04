import { CATEGORIES, validateQuestion } from './validate.js';

const SYSTEM = `Eres el editor de «La Bola Negra», una web donde cada día toda España vota una pregunta con bola blanca (sí) o bola negra (no).

Escribe UNA pregunta nueva, en español de España, que cumpla todo esto:
- Se responde con sí o no. Empieza por «¿» y termina por «?».
- Entre 30 y 120 caracteres. Clara y directa, sin dobles negaciones.
- Le interesa a cualquier persona en España: vida cotidiana, costumbres, ciudades, trabajo, tecnología, gastronomía, cultura, deporte, ocio, educación, consumo, medio ambiente.
- Puede abrir debate, pero sin partidos ni políticos concretos, sin religión, sin violencia, sexo ni tragedias, sin nombres de personas reales y sin señalar a ningún colectivo.
- No repitas ni reformules ninguna de las preguntas recientes.
- No plantees dos alternativas unidas por «o»: tiene que poder contestarse solo con sí o con no.
- Varía: elige un tema y una categoría distintos de las últimas preguntas, y no empieces siempre igual (evita abusar de «¿Debería ser obligatorio…?»). También valen preguntas sobre gustos y costumbres («¿Prefieres…?», «¿Es mejor…?», «¿Te parece bien…?»).

Responde solo con JSON: {"text": "...", "category": "..."}.
"category" debe ser exactamente una de: ${CATEGORIES.join(', ')}.`;

const SCHEMA = {
  type: 'object',
  properties: { text: { type: 'string' }, category: { type: 'string', enum: CATEGORIES } },
  required: ['text', 'category'],
};

const REVIEW = `Eres corrector de estilo de «La Bola Negra», una web española donde cada día se vota una pregunta con sí (bola blanca) o no (bola negra).

Revisa la pregunta que te pasen:
- Ortografía, gramática y concordancia perfectas en español de España (tildes, signos ¿?, artículos).
- Que suene natural, como la escribiría una persona, y se entienda a la primera.
- Que se pueda responder solo con sí o con no: si plantea dos opciones con «o», no vale.
- Que no trate de partidos, políticos, religión, violencia, sexo, tragedias ni personas reales, ni ofenda a ningún colectivo.

Si se puede arreglar con cambios pequeños, corrígela. Si no, recházala.
Responde solo con JSON: {"aprobada": true|false, "text": "pregunta final corregida", "motivo": "explicación breve"}.`;

const REVIEW_SCHEMA = {
  type: 'object',
  properties: { aprobada: { type: 'boolean' }, text: { type: 'string' }, motivo: { type: 'string' } },
  required: ['aprobada', 'text'],
};

function parse(response) {
  if (response && typeof response === 'object') return response;
  if (typeof response !== 'string') return null;
  const match = response.match(/\{[\s\S]*\}/);
  try {
    return match ? JSON.parse(match[0]) : null;
  } catch {
    return null;
  }
}

/** Segunda pasada: el modelo revisa la pregunta como un corrector y la corrige o la rechaza. */
async function review(env, model, question) {
  const out = await env.AI.run(model, {
    messages: [
      { role: 'system', content: REVIEW },
      { role: 'user', content: `Pregunta: ${question.text}\nCategoría: ${question.category}` },
    ],
    max_tokens: 200,
    temperature: 0.2,
    response_format: { type: 'json_schema', json_schema: REVIEW_SCHEMA },
  });
  const verdict = parse(out?.response);
  if (!verdict || verdict.aprobada !== true) {
    return { ok: false, reason: `revisión: ${verdict?.motivo ?? 'rechazada'}` };
  }
  // El corrector a veces devuelve la pregunta entre comillas o con espacios de más.
  const text = typeof verdict.text === 'string'
    ? verdict.text.trim().replace(/^["'«“]+|["'»”]+$/g, '').replace(/\?\s*\.$/, '?').trim()
    : '';
  return { ok: true, question: { ...question, text: text || question.text } };
}

/**
 * Pide una pregunta a Workers AI, la pasa por los filtros y por una revisión de estilo.
 * Devuelve null si no lo consigue.
 * @param {{ AI?: { run: Function }, AI_MODEL?: string }} env
 * @param {Array<string | { text: string, category?: string|null }>} recentItems  de la más reciente a la más antigua
 */
export async function generateWithAI(env, recentItems, { attempts = 3, log = console } = {}) {
  if (!env.AI) return null;
  const model = env.AI_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
  const items = recentItems.map((q) => (typeof q === 'string' ? { text: q, category: null } : q));
  const recent = items.map((q) => q.text);
  const list = items.slice(0, 60).map((q) => `- ${q.category ? `[${q.category}] ` : ''}${q.text}`).join('\n') || '- (ninguna todavía)';
  for (let i = 0; i < attempts; i++) {
    try {
      const out = await env.AI.run(model, {
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `Preguntas recientes:\n${list}\n\nPropón la pregunta de mañana.` },
        ],
        max_tokens: 200,
        temperature: 0.9,
        response_format: { type: 'json_schema', json_schema: SCHEMA },
      });
      const draft = validateQuestion(parse(out?.response), recent);
      if (!draft.ok) {
        log.warn?.(`IA: pregunta descartada (${draft.reason})`);
        continue;
      }
      const reviewed = await review(env, model, draft.question);
      if (!reviewed.ok) {
        log.warn?.(`IA: «${draft.question.text}» descartada (${reviewed.reason})`);
        continue;
      }
      // Si el corrector la aprueba pero su versión no pasa los filtros de formato, vale la original.
      const corrected = validateQuestion(reviewed.question, recent);
      if (!corrected.ok) log.warn?.(`IA: la corrección «${reviewed.question.text}» no pasa (${corrected.reason}); se usa la original`);
      const final = corrected.ok ? corrected : draft;
      if (final.ok) return final.question;
      log.warn?.(`IA: «${draft.question.text}» descartada (${final.reason})`);
    } catch (err) {
      log.warn?.(`IA: error al generar (${err?.message ?? err})`);
    }
  }
  return null;
}
