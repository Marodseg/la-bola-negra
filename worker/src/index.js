import { hmac, UUID_RE } from './crypto.js';
import { closedSessions, toCsv } from './history.js';
import { allowedOrigins, corsHeaders, error, json, readJson, text } from './http.js';
import { ensureQuestion } from './questions/index.js';
import { verifyTurnstile } from './turnstile.js';
import { addDays, isDay, madridDay, msUntilNextDay } from './time.js';
import { BALLS, castVote, findVote, tally, votesFromIp, votesOf } from './votes.js';

/** Identificador anónimo del votante: HMAC del id aleatorio que guarda su navegador. */
async function voterKey(request, env) {
  const id = request.headers.get('X-Votante');
  return id && UUID_RE.test(id) ? hmac(env.HASH_SECRET, `votante:${id.toLowerCase()}`) : null;
}

const clientIp = (request) => request.headers.get('CF-Connecting-IP') ?? '0.0.0.0';
const HUELLA_RE = /^[0-9a-f]{64}$/;

/**
 * Huella del dispositivo en esta conexión y este día. Sobrevive al modo incógnito y a borrar
 * los datos del navegador; al mezclarse con la IP y la fecha no sirve para seguir a nadie.
 */
async function deviceKey(request, env, day) {
  const huella = request.headers.get('X-Huella');
  if (!huella || !HUELLA_RE.test(huella)) return null;
  return hmac(env.HASH_SECRET, `dispositivo:${day}:${clientIp(request)}:${huella}`);
}

const routes = {
  'GET /api/salud': async () => json({ ok: true }),

  'GET /api/hoy': async (request, env, now) => {
    const day = madridDay(now);
    const [question, voter, device] = await Promise.all([ensureQuestion(env, day), voterKey(request, env), deviceKey(request, env, day)]);
    const [results, myBall] = await Promise.all([
      tally(env.DB, day),
      voter || device ? findVote(env.DB, day, voter, device) : null,
    ]);
    return json({
      question,
      myBall,
      // El número de votos se enseña siempre; el reparto, solo a quien ya ha votado.
      totalVotes: results.total,
      results: myBall ? results : null,
      nextInMs: msUntilNextDay(now),
      turnstileSiteKey: env.TURNSTILE_SITE_KEY || null,
    });
  },

  'POST /api/votar': async (request, env, now) => {
    // Sin cookies no hay CSRF clásico, pero solo aceptamos votos desde la propia web.
    if (!allowedOrigins(env).includes(request.headers.get('Origin'))) return error(403, 'Origen no permitido.');

    const body = await readJson(request);
    if (!body) return error(400, 'Petición no válida.');
    if (!BALLS.includes(body.ball)) return error(400, 'Solo valen bolas blancas o negras.');

    const voter = await voterKey(request, env);
    if (!voter) return error(400, 'Falta el identificador del votante.');

    const day = madridDay(now);
    const device = await deviceKey(request, env, day);
    if (!device) return error(400, 'Falta la huella del dispositivo.');
    // Si alguien deja la página abierta a medianoche, su voto no cae en la pregunta siguiente.
    if (body.day !== undefined && (!isDay(body.day) || body.day !== day)) {
      return error(409, 'Esta votación ya se ha cerrado. Recarga para ver la pregunta de hoy.', { closed: true });
    }
    await ensureQuestion(env, day);

    const previous = await findVote(env.DB, day, voter, device);
    if (previous) return error(409, 'Ya se ha votado hoy desde este dispositivo.', { myBall: previous, results: await tally(env.DB, day) });

    const ip = clientIp(request);
    if (!(await verifyTurnstile(env, body.turnstileToken, ip))) {
      return error(403, 'No hemos podido comprobar que no eres un robot. Recarga e inténtalo de nuevo.');
    }

    const ipHash = await hmac(env.HASH_SECRET, `ip:${day}:${ip}`, 22);
    const max = Number(env.MAX_VOTES_PER_IP) || 5;
    if ((await votesFromIp(env.DB, day, ipHash)) >= max) {
      return error(429, 'Ya se han echado demasiadas bolas desde esta conexión hoy.');
    }

    if (!(await castVote(env.DB, { day, voter, deviceKey: device, ipHash, ball: body.ball }))) {
      const existing = await findVote(env.DB, day, voter, device);
      return error(409, 'Ya se ha votado hoy desde este dispositivo.', { myBall: existing, results: await tally(env.DB, day) });
    }
    return json({ myBall: body.ball, results: await tally(env.DB, day) }, { status: 201 });
  },

  'GET /api/archivo': async (request, env, now) => {
    const url = new URL(request.url);
    const before = url.searchParams.get('antes');
    if (before !== null && !isDay(before)) return error(400, 'Fecha no válida.');
    const limit = Math.min(50, Math.max(1, Number.parseInt(url.searchParams.get('limite') ?? '', 10) || 12));

    const items = await closedSessions(env.DB, madridDay(now), { before, limit: limit + 1 });
    const page = items.slice(0, limit);
    const voter = await voterKey(request, env);
    const mine = await votesOf(env.DB, voter, page.map((s) => s.day));
    return json({
      items: page.map((s) => ({ ...s, myBall: mine[s.day] ?? null })),
      next: items.length > limit ? page.at(-1).day : null,
    });
  },

  'GET /api/historico.json': async (request, env, now) => {
    const sessions = await closedSessions(env.DB, madridDay(now));
    return json({ generatedAt: now.toISOString(), sessions }, {
      cache: 'public, max-age=600',
      headers: { 'Content-Disposition': 'inline; filename="la-bola-negra-historico.json"' },
    });
  },

  'GET /api/historico.csv': async (request, env, now) => {
    const sessions = await closedSessions(env.DB, madridDay(now));
    return text(toCsv(sessions), 'text/csv; charset=utf-8', {
      cache: 'public, max-age=600',
      headers: { 'Content-Disposition': 'attachment; filename="la-bola-negra-historico.csv"' },
    });
  },
};

export async function handle(request, env, now = new Date()) {
  const cors = corsHeaders(request, env);
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const method = request.method === 'HEAD' ? 'GET' : request.method;
  const route = routes[`${method} ${url.pathname}`];
  let response;
  if (!route) {
    response = error(404, 'No existe.');
  } else if (!env.HASH_SECRET) {
    response = error(500, 'El servidor no está configurado (falta HASH_SECRET).');
  } else {
    try {
      response = await route(request, env, now);
    } catch (err) {
      console.error(err);
      response = error(500, 'Algo ha fallado. Inténtalo de nuevo en un momento.');
    }
  }
  for (const [k, v] of Object.entries(cors)) response.headers.set(k, v);
  if (request.method === 'HEAD') return new Response(null, { status: response.status, headers: response.headers });
  return response;
}

/** Tarea programada: deja preparadas la pregunta de hoy y la de mañana (aquí sí puede usar la IA). */
export async function prepareQuestions(env, now = new Date()) {
  const today = madridDay(now);
  for (const day of [today, addDays(today, 1)]) {
    const q = await ensureQuestion(env, day, { allowAI: true });
    console.log(`Pregunta del ${day} (${q.source}): ${q.text}`);
  }
}

export default {
  fetch: (request, env) => handle(request, env),
  scheduled: (event, env, ctx) => ctx.waitUntil(prepareQuestions(env, new Date(event.scheduledTime))),
};
