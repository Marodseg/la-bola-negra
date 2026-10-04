import { createUrn, MAX_BALLS } from './urn3d.js';
import { clack, setSoundEnabled, unlockSound } from './sound.js';

const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const fmt = new Intl.NumberFormat('es-ES');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLOR_NAME = { blanca: 'blanca', negra: 'negra' };

// localStorage puede no estar disponible (modo privado, cookies bloqueadas...).
const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* sin almacenamiento */ } },
};

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const deviceId = (() => {
  let id = store.get('bn_dispositivo');
  if (!id || !UUID_RE.test(id)) {
    id = uuid();
    store.set('bn_dispositivo', id);
  }
  return id;
})();

async function api(path, { method = 'GET', body } = {}) {
  try {
    const res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-BN-Dispositivo': deviceId },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
  } catch {
    return { ok: false, status: 0, data: { error: 'Sin conexión. Inténtalo de nuevo.' } };
  }
}

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v);
  }
  for (const child of children.flat()) {
    if (child != null && child !== false) el.append(child);
  }
  return el;
}

let toastTimer;
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

// ---------- Sonido ----------

let soundOn = store.get('bn_sonido') !== '0';
const soundBtn = $('sound-toggle');
function applySound() {
  setSoundEnabled(soundOn);
  soundBtn.setAttribute('aria-pressed', String(soundOn));
  soundBtn.setAttribute('aria-label', soundOn ? 'Silenciar' : 'Activar sonido');
}
applySound();
soundBtn.addEventListener('click', () => {
  soundOn = !soundOn;
  store.set('bn_sonido', soundOn ? '1' : '0');
  applySound();
  if (soundOn) { unlockSound(); clack(0.6); }
});
document.addEventListener('pointerdown', unlockSound, { passive: true });

// ---------- Urna ----------

let buzzed = false;
const stage = $('stage');
const urn = createUrn(stage, {
  onImpact(intensity, { mine }) {
    clack(intensity, mine ? 0.75 : 1);
    if (mine && !buzzed) {
      buzzed = true;
      try { navigator.vibrate?.(14); } catch { /* sin vibración */ }
    }
  },
}) ?? fallbackUrn();

/** Sin WebGL: la votación funciona igual, solo sin la urna animada. */
function fallbackUrn() {
  stage.classList.add('no-webgl');
  return {
    target() {
      const r = stage.getBoundingClientRect();
      return {
        mouth: { x: r.left + r.width / 2, y: r.top + r.height * 0.2 },
        radius: 14,
        box: { left: r.left, right: r.right, top: r.top, bottom: r.bottom },
      };
    },
    drop() {},
    pourTo() { return Promise.resolve(); },
    removeMine() {},
    setFrost() {},
  };
}

/** Cuántas bolas de cada color caben en la urna para representar el resultado. */
function displayCounts(r) {
  if (r.total <= MAX_BALLS) return { blanca: r.blanca, negra: r.negra };
  let b = Math.round((MAX_BALLS * r.blanca) / r.total);
  if (r.blanca > 0 && b === 0) b = 1;
  if (r.negra > 0 && b === MAX_BALLS) b = MAX_BALLS - 1;
  return { blanca: b, negra: MAX_BALLS - b };
}

// ---------- Estado ----------

const state = { day: null, question: null, myBall: null, results: null, busy: false };

// ---------- Pregunta ----------

const dateFmt = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const shortDateFmt = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const asDate = (day) => new Date(`${day}T12:00:00Z`);

function renderQuestion(q) {
  const date = dateFmt.format(asDate(q.day));
  $('date').replaceChildren(
    h('b', {}, date.charAt(0).toUpperCase() + date.slice(1)),
    h('span', { class: 'sep' }), `Pregunta nº ${q.number}`,
    ...(q.tag ? [h('span', { class: 'sep' }), q.tag] : []),
  );
  // Las palabras entran una a una, desenfocándose.
  const words = q.text.split(/\s+/);
  $('question').replaceChildren(...words.flatMap((word, i) => [
    h('span', { class: 'w', style: `animation-delay:${120 + i * 70}ms` }, word),
    ...(i < words.length - 1 ? [' '] : []),
  ]));
  document.title = `${q.text} · La Bola Negra`;
}

function renderLive(total) {
  $('live').hidden = false;
  $('live-count').textContent = fmt.format(total);
  $('live-word').textContent = total === 1 ? 'voto hoy' : 'votos hoy';
}

// ---------- Resultados ----------

const shown = { blanca: 0, negra: 0, pb: 0, pn: 0 };

function animateNumber(key, el, to, ms, suffix = '') {
  const from = shown[key];
  shown[key] = to;
  if (reducedMotion || ms <= 0 || from === to) {
    el.textContent = fmt.format(to) + suffix;
    return;
  }
  const start = performance.now();
  const step = (now) => {
    const u = Math.min(1, (now - start) / ms);
    const eased = 1 - (1 - u) ** 3;
    el.textContent = fmt.format(Math.round(from + (to - from) * eased)) + suffix;
    if (u < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function percents(r) {
  if (!r.total) return { pb: 0, pn: 0 };
  const pb = Math.round((100 * r.blanca) / r.total);
  return { pb, pn: 100 - pb };
}

function renderResults(r, ms = 1600) {
  const { pb, pn } = percents(r);
  animateNumber('blanca', $('count-blanca'), r.blanca, ms);
  animateNumber('negra', $('count-negra'), r.negra, ms);
  animateNumber('pb', $('pct-blanca'), pb, ms);
  animateNumber('pn', $('pct-negra'), pn, ms);
  $('bar-blanca').style.width = `${r.total ? (100 * r.blanca) / r.total : 50}%`;
  $('bar-negra').style.width = `${r.total ? (100 * r.negra) / r.total : 50}%`;

  document.querySelector('.side--blanca').classList.toggle('lead', r.blanca >= r.negra);
  document.querySelector('.side--negra').classList.toggle('lead', r.negra >= r.blanca);
  document.body.classList.toggle('winner-blanca', r.blanca > r.negra);
  document.body.classList.toggle('winner-negra', r.negra > r.blanca);

  const verdict = $('verdict');
  if (r.total <= 1) verdict.replaceChildren('Tu bola es ', h('i', {}, 'la primera'), ' de hoy.');
  else if (r.blanca === r.negra) verdict.replaceChildren('Empate. ', h('i', {}, 'España está partida en dos.'));
  else if (r.blanca > r.negra) verdict.replaceChildren('Gana la bola blanca. ', h('i', {}, 'España dice sí.'));
  else verdict.replaceChildren('Gana la bola negra. ', h('i', {}, 'España dice no.'));

  const chip = $('mine-chip');
  chip.textContent = `Tu bola: ${COLOR_NAME[state.myBall] ?? '—'}`;
  chip.style.setProperty('--mine-bg', state.myBall === 'blanca' ? '#f2efe8' : '#050505');

  let fine = `${fmt.format(r.total)} ${r.total === 1 ? 'persona ha votado' : 'personas han votado'} hoy`;
  if (r.total > MAX_BALLS) fine += ` · cada bola de la urna ≈ ${fmt.format(Math.round(r.total / MAX_BALLS))} votos`;
  $('fine').textContent = fine;
  renderLive(r.total);
}

async function reveal(results, myBall, { fresh }) {
  state.myBall = myBall;
  state.results = results;

  const vote = $('vote');
  if (!vote.hidden) {
    vote.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(12px)' }], { duration: 400, fill: 'forwards' });
    setTimeout(() => { vote.hidden = true; }, 400);
  }

  $('secret').classList.add('out');
  urn.setFrost(0, reducedMotion ? 1 : 1600);
  await wait(reducedMotion ? 0 : fresh ? 900 : 300);

  const target = displayCounts(results);
  const n = target.blanca + target.negra;
  const duration = reducedMotion ? 200 : Math.min(3800, 500 + n * 28);
  urn.pourTo(target, { mineColor: fresh ? null : myBall, duration });

  $('results').hidden = false;
  renderResults(results, duration);
  startLiveUpdates();
}

// ---------- Votar ----------

const tray = document.querySelector('.choices');
let armed = null;
let lastDragEnd = 0;

function setHint(text) { $('hint').textContent = text; }

function disarm() {
  armed?.classList.remove('armed');
  armed = null;
  setHint('Arrastra tu bola a la urna, o tócala dos veces.');
}

function centerOf(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, size: r.width };
}

function makeClone(ball) {
  const c = centerOf(ball);
  const clone = ball.cloneNode(false);
  clone.removeAttribute('aria-label');
  clone.classList.remove('armed');
  clone.classList.add('flying', 'dragging');
  clone.style.width = clone.style.height = `${c.size}px`;
  document.body.append(clone);
  ball.classList.add('gone');
  const pos = { x: c.x, y: c.y, s: 1 };
  placeClone(clone, pos, c.size);
  return { el: clone, pos, size: c.size, home: c };
}

function placeClone(el, { x, y, s }, size) {
  el.style.transform = `translate(${x - size / 2}px, ${y - size / 2}px) scale(${s})`;
}

/** Vuelo en parábola desde la posición actual hasta la boca de la urna. */
function flyToUrn(clone) {
  const t = urn.target();
  const from = { ...clone.pos };
  const to = { x: t.mouth.x, y: t.mouth.y, s: (t.radius * 2) / clone.size };
  const ctrl = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - Math.max(60, Math.abs(from.y - to.y) * 0.35) };
  const duration = reducedMotion ? 1 : 560;
  const start = performance.now();
  return new Promise((resolve) => {
    const step = (now) => {
      const u = Math.min(1, (now - start) / duration);
      const e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
      const v = 1 - e;
      const pos = {
        x: v * v * from.x + 2 * v * e * ctrl.x + e * e * to.x,
        y: v * v * from.y + 2 * v * e * ctrl.y + e * e * to.y,
        s: from.s + (to.s - from.s) * e,
      };
      placeClone(clone.el, pos, clone.size);
      if (u < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

function returnHome(clone, ball) {
  const anim = clone.el.animate(
    [
      { transform: clone.el.style.transform },
      { transform: `translate(${clone.home.x - clone.size / 2}px, ${clone.home.y - clone.size / 2}px) scale(1)` },
    ],
    { duration: reducedMotion ? 1 : 380, easing: 'cubic-bezier(.2,.9,.3,1.2)', fill: 'forwards' },
  );
  anim.onfinish = () => {
    clone.el.remove();
    ball.classList.remove('gone');
  };
}

async function throwBall(ball, clone = makeClone(ball)) {
  if (state.busy) return;
  state.busy = true;
  const color = ball.dataset.ball;
  disarm();
  tray.classList.add('disabled');
  setHint('Tu bola cae en la urna…');

  await flyToUrn(clone);
  clone.el.remove();
  urn.drop(color, { mine: true, vy: 4 });

  const [res] = await Promise.all([
    api('/api/votar', { method: 'POST', body: { ball: color, day: state.day } }),
    wait(reducedMotion ? 300 : 1300),
  ]);

  if (res.ok) {
    reveal(res.data.results, res.data.myBall, { fresh: true });
    return;
  }
  if (res.status === 409 && res.data.results) {
    toast(res.data.error);
    if (res.data.myBall !== color) urn.removeMine();
    reveal(res.data.results, res.data.myBall, { fresh: res.data.myBall === color });
    return;
  }
  if (res.data.closed) {
    toast(res.data.error);
    setTimeout(() => location.reload(), 2000);
    return;
  }

  // El voto no entró: devolvemos la bola a la bandeja.
  toast(res.data.error ?? 'No se ha podido registrar tu voto.');
  urn.removeMine();
  ball.classList.remove('gone');
  tray.classList.remove('disabled');
  setHint('Arrastra tu bola a la urna, o tócala dos veces.');
  state.busy = false;
}

function setupTray() {
  let drag = null;

  for (const ball of document.querySelectorAll('.ball')) {
    ball.addEventListener('click', () => {
      if (state.busy || performance.now() - lastDragEnd < 400) return;
      unlockSound();
      if (armed === ball) {
        throwBall(ball);
        return;
      }
      armed?.classList.remove('armed');
      armed = ball;
      ball.classList.add('armed');
      setHint(`¿Bola ${COLOR_NAME[ball.dataset.ball]}? Tócala otra vez para echarla a la urna.`);
    });

    ball.addEventListener('pointerdown', (e) => {
      if (state.busy || e.button > 0) return;
      drag = { ball, id: e.pointerId, x0: e.clientX, y0: e.clientY, clone: null, samples: [] };
      ball.setPointerCapture(e.pointerId);
    });

    ball.addEventListener('pointermove', (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const dx = e.clientX - drag.x0;
      const dy = e.clientY - drag.y0;
      if (!drag.clone) {
        if (Math.hypot(dx, dy) < 8) return;
        disarm();
        drag.clone = makeClone(ball);
      }
      const c = drag.clone;
      c.pos = { x: c.home.x + dx, y: c.home.y + dy, s: 1.08 };
      placeClone(c.el, c.pos, c.size);
    });

    const end = (e, cancelled) => {
      if (!drag || drag.id !== e.pointerId) return;
      const d = drag;
      drag = null;
      if (!d.clone) return; // Ha sido un toque: lo gestiona el evento click.
      lastDragEnd = performance.now();
      const { box } = urn.target();
      const inside = !cancelled && e.clientX >= box.left && e.clientX <= box.right && e.clientY >= box.top && e.clientY <= box.bottom;
      if (inside) {
        d.clone.el.classList.remove('dragging');
        throwBall(ball, d.clone);
      } else {
        returnHome(d.clone, ball);
        setHint('Suelta la bola encima de la urna para votar.');
      }
    };
    ball.addEventListener('pointerup', (e) => end(e, false));
    ball.addEventListener('pointercancel', (e) => end(e, true));
  }

  document.addEventListener('click', (e) => {
    if (armed && !e.target.closest('.ball')) disarm();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') disarm();
  });
}

// ---------- Cuenta atrás y actualizaciones en directo ----------

function startCountdown(ms) {
  const endAt = Date.now() + ms;
  const el = $('countdown');
  let reloading = false;
  const tick = () => {
    const left = Math.max(0, endAt - Date.now());
    const s = Math.floor(left / 1000);
    el.textContent = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
      .map((n) => String(n).padStart(2, '0')).join(':');
    el.dateTime = `PT${s}S`;
    if (left === 0 && !reloading) {
      reloading = true;
      toast('¡Nueva pregunta!');
      setTimeout(() => location.reload(), 1500);
    }
  };
  tick();
  setInterval(tick, 1000);
}

let liveTimer = null;
function startLiveUpdates() {
  if (liveTimer) return;
  liveTimer = setInterval(async () => {
    if (document.hidden) return;
    const { ok, data } = await api('/api/hoy');
    if (!ok) return;
    if (data.question.day !== state.day) {
      location.reload();
      return;
    }
    renderLive(data.totalVotes);
    if (state.myBall && data.results && data.results.total !== state.results.total) {
      state.results = data.results;
      renderResults(data.results, 900);
      urn.pourTo(displayCounts(data.results), { duration: 1500 });
    }
  }, 15_000);
}

// ---------- Compartir ----------

$('share').addEventListener('click', async () => {
  const text = `Hoy en La Bola Negra: «${state.question.text}» Yo ya he echado mi bola. ¿Blanca o negra?`;
  const url = location.origin;
  if (navigator.share) {
    try { await navigator.share({ title: 'La Bola Negra', text, url }); } catch { /* cancelado */ }
    return;
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    toast('Enlace copiado. ¡Pásalo!');
  } catch {
    toast(url);
  }
});

// ---------- Archivo ----------

async function loadArchive() {
  const list = $('archive');
  const { ok, data } = await api('/api/archivo?limite=14');
  if (!ok) return;
  if (!data.items.length) {
    list.replaceChildren(h('li', { class: 'archive-empty' }, 'Hoy es el primer día. Aquí irán apareciendo las votaciones anteriores.'));
    return;
  }
  list.replaceChildren(...data.items.map((item) => {
    const r = item.results;
    const { pb, pn } = percents(r);
    // 60 puntos: cada uno es un 1,67 % de los votos.
    const DOTS = 60;
    const white = r.total ? Math.round((DOTS * r.blanca) / r.total) : 0;
    const dots = Array.from({ length: DOTS }, (_, i) => h('span', { class: !r.total ? 'e' : i < white ? 'b' : 'n' }));
    const winner = r.blanca === r.negra ? 'Empate' : r.blanca > r.negra ? 'Sí' : 'No';
    return h('li', { class: 'arch' },
      h('div', { class: 'arch-head' }, h('span', {}, shortDateFmt.format(asDate(item.day))), h('span', {}, `Nº ${item.number}`)),
      h('p', { class: 'arch-q' }, item.text),
      h('div', { class: 'dots', 'aria-hidden': 'true' }, dots),
      h('div', { class: 'arch-foot' },
        h('span', { class: 'big' }, r.total ? `${Math.max(pb, pn)}%` : '—', h('small', {}, r.total ? winner : 'Sin votos')),
        h('span', { class: 'total' }, `${fmt.format(r.total)} ${r.total === 1 ? 'voto' : 'votos'}`)),
      item.myBall ? h('span', { class: 'arch-mine' }, `Tu bola: ${COLOR_NAME[item.myBall]}`) : null,
    );
  }));
}

// ---------- Arranque ----------

async function init() {
  const { ok, data } = await api('/api/hoy');
  if (!ok) {
    $('question').replaceChildren(h('span', { class: 'question-loading' }, data.error ?? 'No se ha podido abrir la urna.'));
    return;
  }
  state.day = data.question.day;
  state.question = data.question;
  renderQuestion(data.question);
  startCountdown(data.nextInMs);
  renderLive(data.totalVotes);
  startLiveUpdates();

  if (data.myBall) {
    reveal(data.results, data.myBall, { fresh: false });
  } else {
    $('vote').hidden = false;
    $('secret').hidden = false;
    setupTray();
  }
  loadArchive();
}

init();
