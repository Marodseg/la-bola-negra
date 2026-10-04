import { CATEGORIES, validateQuestion } from './validate.js';

const SYSTEM = `Eres el editor de «La Bola Negra», una web donde cada día toda España vota una pregunta con bola blanca (sí) o bola negra (no).

Escribe UNA pregunta nueva, en español de España, que cumpla todo esto:
- Se responde con sí o no. Empieza por «¿» y termina por «?».
- Entre 30 y 120 caracteres. Clara y directa, sin dobles negaciones.
- Le interesa a cualquier persona en España: vida cotidiana, costumbres, ciudades, trabajo, tecnología, gastronomía, cultura, deporte, ocio, educación, consumo, medio ambiente.
- Puede abrir debate, pero sin partidos ni políticos concretos, sin religión, sin violencia, sexo ni tragedias, sin nombres de personas reales y sin señalar a ningún colectivo.
- No repitas ni reformules ninguna de las preguntas recientes.

Responde solo con JSON: {"text": "...", "category": "..."}.
"category" debe ser exactamente una de: ${CATEGORIES.join(', ')}.`;

const SCHEMA = {
  type: 'object',
  properties: { text: { type: 'string' }, category: { type: 'string', enum: CATEGORIES } },
  required: ['text', 'category'],
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

/**
 * Pide una pregunta a Workers AI y la pasa por los filtros. Devuelve null si no lo consigue.
 * @param {{ AI?: { run: Function }, AI_MODEL?: string }} env
 * @param {string[]} recent
 */
export async function generateWithAI(env, recent, { attempts = 3, log = console } = {}) {
  if (!env.AI) return null;
  const model = env.AI_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
  const list = recent.slice(0, 60).map((t) => `- ${t}`).join('\n') || '- (ninguna todavía)';
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
      const result = validateQuestion(parse(out?.response), recent);
      if (result.ok) return result.question;
      log.warn?.(`IA: pregunta descartada (${result.reason})`);
    } catch (err) {
      log.warn?.(`IA: error al generar (${err?.message ?? err})`);
    }
  }
  return null;
}
