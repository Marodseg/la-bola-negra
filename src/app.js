import crypto from 'node:crypto';
import path from 'node:path';
import express from 'express';
import { BALLS } from './db.js';
import { madridDay, msUntilNextDay } from './time.js';

const VOTER_COOKIE = 'bn_votante';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ONE_YEAR_S = 60 * 60 * 24 * 365;

/**
 * @param {object} opts
 * @param {ReturnType<import('./db.js').openDb>} opts.db
 * @param {ReturnType<import('./questions.js').loadQuestions>} opts.questions
 * @param {string} opts.secret      firma la cookie del votante y el hash de la IP
 * @param {number} [opts.maxVotesPerIp]  tope de votos por IP y día (familias, oficinas...)
 * @param {() => Date} [opts.now]
 */
export function createApp({ db, questions, secret, maxVotesPerIp = 25, now = () => new Date(), trustProxy = false }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);

  const hmac = (value) => crypto.createHmac('sha256', secret).update(value).digest('base64url');

  function readCookie(req, name) {
    const header = req.headers.cookie ?? '';
    for (const part of header.split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k === name) return decodeURIComponent(v.join('='));
    }
    return null;
  }

  /** Identificador anónimo del votante, guardado en una cookie firmada. */
  function voterId(req, res) {
    const raw = readCookie(req, VOTER_COOKIE);
    if (raw) {
      const [id, sig] = raw.split('.');
      if (UUID_RE.test(id ?? '') && sig === hmac(id)) return id;
    }
    const id = crypto.randomUUID();
    const secure = req.secure ? '; Secure' : '';
    res.append('Set-Cookie', `${VOTER_COOKIE}=${id}.${hmac(id)}; Max-Age=${ONE_YEAR_S}; Path=/; HttpOnly; SameSite=Lax${secure}`);
    return id;
  }

  /** Segundo identificador que el navegador guarda en localStorage. */
  function deviceId(req) {
    const value = req.get('x-bn-dispositivo');
    return value && UUID_RE.test(value) ? value.toLowerCase() : null;
  }

  const ipHash = (req) => hmac(`ip:${req.ip}`).slice(0, 24);

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'X-Frame-Options': 'DENY',
    });
    next();
  });

  app.use(express.json({ limit: '2kb' }));

  app.get('/api/hoy', (req, res) => {
    const day = madridDay(now());
    const question = questions.questionFor(day);
    if (!question) return res.status(404).json({ error: 'Todavía no hay preguntas. ¡Vuelve pronto!' });

    const myBall = db.findVote(day, voterId(req, res), deviceId(req));
    res.set('Cache-Control', 'no-store').json({
      question,
      myBall,
      // Los resultados solo se ven después de votar, para no influir en nadie.
      results: myBall ? db.tally(day) : null,
      nextInMs: msUntilNextDay(now()),
    });
  });

  app.post('/api/votar', (req, res) => {
    const ball = req.body?.ball;
    if (!BALLS.includes(ball)) return res.status(400).json({ error: 'Solo valen bolas blancas o negras.' });

    const day = madridDay(now());
    // Si alguien deja la página abierta a medianoche, su voto no debe caer en la pregunta siguiente.
    if (req.body.day && req.body.day !== day) {
      return res.status(409).json({ error: 'Esta votación ya se ha cerrado. Recarga para ver la pregunta de hoy.', closed: true });
    }
    if (!questions.questionFor(day)) return res.status(404).json({ error: 'Hoy no hay votación.' });

    const voter = voterId(req, res);
    const device = deviceId(req);
    res.set('Cache-Control', 'no-store');

    const previous = db.findVote(day, voter, device);
    if (previous) {
      return res.status(409).json({ error: 'Ya has echado tu bola hoy.', myBall: previous, results: db.tally(day) });
    }

    const hash = ipHash(req);
    if (db.votesFromIp(day, hash) >= maxVotesPerIp) {
      return res.status(429).json({ error: 'Demasiados votos desde esta conexión hoy.' });
    }

    if (!db.castVote({ day, voter, device, ipHash: hash, ball })) {
      const existing = db.findVote(day, voter, device);
      return res.status(409).json({ error: 'Ya has echado tu bola hoy.', myBall: existing, results: db.tally(day) });
    }
    res.status(201).json({ myBall: ball, results: db.tally(day) });
  });

  app.get('/api/archivo', (req, res) => {
    const today = madridDay(now());
    const limit = Math.min(60, Math.max(1, Number.parseInt(req.query.limite, 10) || 14));
    const voter = voterId(req, res);
    const device = deviceId(req);
    const items = questions.pastDays(today, limit).map((day) => ({
      ...questions.questionFor(day),
      results: db.tally(day),
      myBall: db.findVote(day, voter, device),
    }));
    res.set('Cache-Control', 'no-store').json({ items });
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'No existe.' }));

  const root = path.resolve(import.meta.dirname, '..');
  app.get('/vendor/matter.min.js', (req, res) => {
    res.sendFile(path.join(root, 'node_modules/matter-js/build/matter.min.js'), { maxAge: '7d' });
  });
  app.use(express.static(path.join(root, 'public'), { maxAge: '1h' }));

  return app;
}
