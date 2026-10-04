import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { handle, prepareQuestions } from '../worker/src/index.js';
import { generateWithAI } from '../worker/src/questions/ai.js';
import { BANK, EDITORIAL, chooseQuestion } from '../worker/src/questions/index.js';
import { similarity, validateQuestion } from '../worker/src/questions/validate.js';
import { toCsv } from '../worker/src/history.js';
import { createD1 } from './d1.js';

const ORIGIN = 'https://marodseg.github.io';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const quiet = { warn() {} };

let env;
beforeEach(() => {
  env = { DB: createD1(), HASH_SECRET: 'test', ALLOWED_ORIGINS: `${ORIGIN},http://localhost:5173`, MAX_VOTES_PER_IP: '3' };
});

const at = (iso) => new Date(iso);
const NOW = at('2026-10-04T10:00:00Z');

function call(method, path, { body, voter, ip = '1.1.1.1', origin = ORIGIN, now = NOW } = {}) {
  const headers = { 'CF-Connecting-IP': ip };
  if (origin) headers.Origin = origin;
  if (voter) headers['X-Votante'] = voter;
  if (body) headers['Content-Type'] = 'application/json';
  const req = new Request(`https://api.test${path}`, { method, headers, body: body && JSON.stringify(body) });
  return handle(req, env, now).then(async (res) => ({ res, status: res.status, data: res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text() }));
}

describe('votación', () => {
  test('oculta el reparto hasta votar y solo deja votar una vez', async () => {
    let r = await call('GET', '/api/hoy', { voter: A });
    assert.equal(r.status, 200);
    assert.equal(r.data.question.day, '2026-10-04');
    assert.equal(r.data.question.number, 1);
    assert.equal(r.data.results, null);
    assert.equal(r.data.totalVotes, 0);

    r = await call('POST', '/api/votar', { voter: A, body: { ball: 'negra', day: '2026-10-04' } });
    assert.equal(r.status, 201);
    assert.deepEqual(r.data.results, { blanca: 0, negra: 1, total: 1 });

    r = await call('POST', '/api/votar', { voter: A, body: { ball: 'blanca' } });
    assert.equal(r.status, 409);
    assert.equal(r.data.myBall, 'negra');

    r = await call('GET', '/api/hoy', { voter: A });
    assert.equal(r.data.myBall, 'negra');
    assert.equal(r.data.results.total, 1);

    r = await call('GET', '/api/hoy', { voter: B });
    assert.equal(r.data.results, null);
    assert.equal(r.data.totalVotes, 1);
  });

  test('rechaza peticiones mal formadas o de otros orígenes', async () => {
    assert.equal((await call('POST', '/api/votar', { voter: A, body: { ball: 'gris' } })).status, 400);
    assert.equal((await call('POST', '/api/votar', { body: { ball: 'blanca' } })).status, 400);
    assert.equal((await call('POST', '/api/votar', { voter: 'no-es-un-uuid', body: { ball: 'blanca' } })).status, 400);
    assert.equal((await call('POST', '/api/votar', { voter: A, origin: 'https://malo.example', body: { ball: 'blanca' } })).status, 403);
    assert.equal((await call('POST', '/api/votar', { voter: A, origin: null, body: { ball: 'blanca' } })).status, 403);
    assert.equal((await call('POST', '/api/votar', { voter: A, body: { ball: 'blanca', day: '2026-10-03' } })).status, 409);
  });

  test('limita los votos por conexión y día', async () => {
    const ids = ['a', 'b', 'c', 'd'].map((c) => `${c.repeat(8)}-aaaa-4aaa-8aaa-${'a'.repeat(12)}`);
    const statuses = [];
    for (const id of ids) statuses.push((await call('POST', '/api/votar', { voter: id, body: { ball: 'blanca' } })).status);
    assert.deepEqual(statuses, [201, 201, 201, 429]);
    // Otra conexión sí puede
    assert.equal((await call('POST', '/api/votar', { voter: ids[3], ip: '2.2.2.2', body: { ball: 'blanca' } })).status, 201);
  });

  test('exige Turnstile cuando está configurado', async () => {
    env.TURNSTILE_SECRET = 'secreto';
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (_url, opts) => new Response(JSON.stringify({ success: opts.body.get('response') === 'ok' }));
    try {
      assert.equal((await call('POST', '/api/votar', { voter: A, body: { ball: 'blanca' } })).status, 403);
      assert.equal((await call('POST', '/api/votar', { voter: A, body: { ball: 'blanca', turnstileToken: 'mal' } })).status, 403);
      assert.equal((await call('POST', '/api/votar', { voter: A, body: { ball: 'blanca', turnstileToken: 'ok' } })).status, 201);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test('no guarda el identificador ni la IP en claro', async () => {
    await call('POST', '/api/votar', { voter: A, ip: '9.9.9.9', body: { ball: 'blanca' } });
    const row = env.DB.raw.prepare('SELECT voter, ip_hash FROM votes').get();
    assert.ok(!row.voter.includes('1111'));
    assert.ok(!row.ip_hash.includes('9.9.9.9'));
  });

  test('CORS solo para los orígenes permitidos', async () => {
    const ok = await call('OPTIONS', '/api/votar');
    assert.equal(ok.status, 204);
    assert.equal(ok.res.headers.get('access-control-allow-origin'), ORIGIN);
    const bad = await call('GET', '/api/hoy', { origin: 'https://malo.example' });
    assert.equal(bad.res.headers.get('access-control-allow-origin'), null);
  });

  test('falla de forma segura si falta el secreto', async () => {
    delete env.HASH_SECRET;
    assert.equal((await call('GET', '/api/hoy')).status, 500);
  });
});

describe('preguntas', () => {
  test('cambia cada día y numera las sesiones', async () => {
    const d1 = await call('GET', '/api/hoy', { now: at('2026-10-04T21:59:00Z') });
    const d2 = await call('GET', '/api/hoy', { now: at('2026-10-04T22:01:00Z') }); // medianoche en Madrid (verano)
    assert.equal(d1.data.question.day, '2026-10-04');
    assert.equal(d2.data.question.day, '2026-10-05');
    assert.equal(d2.data.question.number, 2);
    assert.notEqual(d1.data.question.text, d2.data.question.text);
    assert.equal(d1.data.question.text, BANK[0].text);
  });

  test('respeta las preguntas fijadas a una fecha', async () => {
    const [day, q] = Object.entries(EDITORIAL)[0];
    const r = await call('GET', '/api/hoy', { now: at(`${day}T12:00:00Z`) });
    assert.equal(r.data.question.text, q.text);
    assert.equal(r.data.question.source, 'editorial');
  });

  test('la tarea programada deja lista la pregunta de mañana', async () => {
    await prepareQuestions(env, at('2026-10-04T20:00:00Z'));
    const rows = env.DB.raw.prepare('SELECT day FROM questions ORDER BY day').all().map((r) => r.day);
    assert.deepEqual(rows, ['2026-10-04', '2026-10-05']);
  });

  test('elige banco, después IA y, si la IA falla, recicla', async () => {
    const insert = env.DB.raw.prepare('INSERT INTO questions VALUES (?, ?, ?, ?, ?, ?)');
    BANK.forEach((q, i) => {
      const d = new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10);
      insert.run(d, i + 1, q.text, q.category, 'banco', 0);
    });

    env.AI = { run: async () => ({ response: { text: '¿Te gusta desayunar churros los domingos por la mañana?', category: 'Gastronomía' } }) };
    const ai = await chooseQuestion(env, '2030-01-01', { allowAI: true, log: quiet });
    assert.equal(ai.source, 'ia');

    // Sin IA en peticiones normales: se recicla la más antigua.
    const recycled = await chooseQuestion(env, '2030-01-01', { allowAI: false, log: quiet });
    assert.equal(recycled.source, 'reciclada');
    assert.equal(recycled.text, BANK[0].text);

    env.AI = { run: async () => { throw new Error('caído'); } };
    const fallback = await chooseQuestion(env, '2030-01-01', { allowAI: true, log: quiet });
    assert.equal(fallback.source, 'reciclada');
  });

  test('la IA solo publica preguntas que pasan los filtros', async () => {
    const replies = [
      'esto no es json',
      { text: '¿Debería Sánchez dimitir hoy mismo por todo lo que ha pasado?', category: 'Política' },
      { text: '¿Te gusta el café?', category: 'Gastronomía' },
      '{"text": "¿Deberían los museos abrir gratis el primer domingo de cada mes?", "category": "Cultura"}',
    ];
    let i = 0;
    const fakeEnv = { AI: { run: async () => ({ response: replies[i++] }) } };
    assert.equal(await generateWithAI(fakeEnv, [], { attempts: 3, log: quiet }), null);
    i = 3;
    const q = await generateWithAI(fakeEnv, [], { attempts: 1, log: quiet });
    assert.equal(q.text, '¿Deberían los museos abrir gratis el primer domingo de cada mes?');
  });

  test('validación de preguntas', () => {
    const ok = (text, category = 'Vida', recent = []) => validateQuestion({ text, category }, recent).ok;
    assert.ok(ok('¿Prefieres la playa a la montaña para ir de vacaciones?'));
    assert.ok(!ok('Prefieres la playa a la montaña para ir de vacaciones'));
    assert.ok(!ok('¿Playa? ¿O montaña? Elige bien tus vacaciones'));
    assert.ok(!ok('¿Prefieres la playa a la montaña para ir de vacaciones?', 'Inventada'));
    assert.ok(!ok('¿Debería volver la mili obligatoria con armas para todos?', 'Sociedad'));
    assert.ok(!ok('¿Visitarías www.ejemplo.com para votar esta pregunta?'));
    assert.ok(!ok('¿Prefieres ir de vacaciones a la playa antes que a la montaña?', 'Vida', ['¿Prefieres la playa a la montaña para ir de vacaciones?']));
    assert.ok(similarity('¿Tortilla con cebolla?', '¿Tortilla de patatas con cebolla?') > 0.5);
  });
});

describe('histórico', () => {
  test('archivo paginado con tu voto y sin la votación abierta', async () => {
    for (let i = 0; i < 5; i++) {
      const now = new Date(Date.UTC(2026, 9, 1 + i, 10));
      await call('POST', '/api/votar', { voter: A, now, body: { ball: i % 2 ? 'negra' : 'blanca' } });
    }
    const now = at('2026-10-05T10:00:00Z');
    const p1 = await call('GET', '/api/archivo?limite=2', { voter: A, now });
    assert.deepEqual(p1.data.items.map((s) => s.day), ['2026-10-04', '2026-10-03']);
    assert.equal(p1.data.items[0].myBall, 'negra');
    assert.equal(p1.data.next, '2026-10-03');
    const p2 = await call('GET', `/api/archivo?limite=2&antes=${p1.data.next}`, { now });
    assert.deepEqual(p2.data.items.map((s) => s.day), ['2026-10-02', '2026-10-01']);
    assert.equal(p2.data.items[0].myBall, null);
    assert.equal(p2.data.next, null);
    assert.equal((await call('GET', '/api/archivo?antes=ayer', { now })).status, 400);
  });

  test('exporta CSV seguro para Excel y JSON', async () => {
    const csv = toCsv([{ number: 1, day: '2026-10-04', text: '=HYPERLINK("x"), "hola"', category: 'Vida', source: 'banco', results: { blanca: 2, negra: 1, total: 3 } }]);
    assert.ok(csv.startsWith('﻿numero,fecha'));
    assert.ok(csv.includes(`"'=HYPERLINK(""x""), ""hola"""`));
    assert.ok(csv.includes(',aprobada'));

    await call('POST', '/api/votar', { voter: A, body: { ball: 'blanca' } });
    const r = await call('GET', '/api/historico.json', { now: at('2026-10-05T10:00:00Z') });
    assert.equal(r.data.sessions.length, 1);
    assert.equal(r.res.headers.get('cache-control'), 'public, max-age=600');
    const c = await call('GET', '/api/historico.csv', { now: at('2026-10-05T10:00:00Z') });
    assert.match(c.res.headers.get('content-type'), /text\/csv/);
  });
});
