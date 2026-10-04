import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { loadQuestions } from '../src/questions.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bola-'));
const questionsFile = path.join(dir, 'questions.json');
fs.writeFileSync(questionsFile, JSON.stringify({
  start: '2026-10-01',
  fixed: { '2026-10-03': { text: 'Fija', tag: 'X' } },
  pool: [{ text: 'Uno' }, { text: 'Dos' }],
}));

let clock = new Date('2026-10-04T10:00:00Z');
const db = openDb(':memory:');
const app = createApp({
  db, questions: loadQuestions(questionsFile), secret: 'test', maxVotesPerIp: 3, now: () => clock,
});
let server;
let base;

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); db.close(); });

/** Un "navegador": guarda su cookie y su id de dispositivo. */
function browser(device) {
  let cookie = '';
  return async (route, body) => {
    const headers = { 'Content-Type': 'application/json' };
    if (cookie) headers.Cookie = cookie;
    if (device) headers['X-BN-Dispositivo'] = device;
    const res = await fetch(base + route, { method: body ? 'POST' : 'GET', headers, body: body && JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json() };
  };
}

test('las preguntas rotan por día y respetan las fijas', () => {
  const q = loadQuestions(questionsFile);
  assert.equal(q.questionFor('2026-09-30'), null);
  assert.equal(q.questionFor('2026-10-01').text, 'Uno');
  assert.equal(q.questionFor('2026-10-02').text, 'Dos');
  assert.equal(q.questionFor('2026-10-03').text, 'Fija');
  assert.equal(q.questionFor('2026-10-04').number, 4);
  assert.deepEqual(q.pastDays('2026-10-04', 10), ['2026-10-03', '2026-10-02', '2026-10-01']);
});

test('los resultados se ocultan hasta votar y solo se vota una vez', async () => {
  const ana = browser('11111111-1111-4111-8111-111111111111');
  let res = await ana('/api/hoy');
  assert.equal(res.status, 200);
  assert.equal(res.data.question.day, '2026-10-04');
  assert.equal(res.data.results, null);

  res = await ana('/api/votar', { ball: 'gris' });
  assert.equal(res.status, 400);

  res = await ana('/api/votar', { ball: 'negra', day: '2026-10-04' });
  assert.equal(res.status, 201);
  assert.deepEqual(res.data.results, { blanca: 0, negra: 1, total: 1 });

  res = await ana('/api/votar', { ball: 'blanca' });
  assert.equal(res.status, 409);
  assert.equal(res.data.myBall, 'negra');

  res = await ana('/api/hoy');
  assert.equal(res.data.myBall, 'negra');
  assert.equal(res.data.results.total, 1);
});

test('borrar la cookie no permite votar otra vez desde el mismo dispositivo', async () => {
  const device = '22222222-2222-4222-8222-222222222222';
  assert.equal((await browser(device)('/api/votar', { ball: 'blanca' })).status, 201);
  const res = await browser(device)('/api/votar', { ball: 'negra' });
  assert.equal(res.status, 409);
  assert.equal(res.data.myBall, 'blanca');
});

test('rechaza votos para un día ya cerrado y limita votos por IP', async () => {
  assert.equal((await browser()('/api/votar', { ball: 'blanca', day: '2026-10-03' })).status, 409);
  // Ya hay 2 votos desde 127.0.0.1 (tope 3).
  assert.equal((await browser()('/api/votar', { ball: 'blanca' })).status, 201);
  assert.equal((await browser()('/api/votar', { ball: 'blanca' })).status, 429);
});

test('al día siguiente la pregunta cambia y la anterior pasa al archivo', async () => {
  clock = new Date('2026-10-05T00:30:00+02:00');
  const res = await browser()('/api/archivo');
  assert.equal(res.status, 200);
  assert.equal(res.data.items[0].day, '2026-10-04');
  assert.deepEqual(res.data.items[0].results, { blanca: 2, negra: 1, total: 3 });
  const today = await browser()('/api/hoy');
  assert.equal(today.data.question.day, '2026-10-05');
});
