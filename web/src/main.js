import './fonts.js';
import './styles/base.css';
import './styles/home.css';
import { api, downloadUrl } from './lib/api.js';
import { $, h, reducedMotion, toast, wait } from './lib/dom.js';
import { fmt, formatLongDate, formatShortDate, percents, percentText, plural, verdict, VERDICT_LABEL } from './lib/format.js';
import { clack, setSoundEnabled, thump, unlockSound } from './lib/sound.js';
import { store } from './lib/store.js';
import { resetTurnstile, setupTurnstile, turnstileActive, turnstileError, turnstileToken } from './lib/turnstile.js';
import { MAX_BALLS } from './urn/constants.js';
import { actaRow, BALL_NAME } from './lib/actas.js';

const HINT = 'Arrastre su bola hasta la urna, o púlsela dos veces.';

const state = { day: null, question: null, myBall: null, results: null, busy: false };

// ---------- Sonido ----------

let soundOn = store.get('bn_sonido') !== '0';
function applySound() {
  setSoundEnabled(soundOn);
  const btn = $('sound-toggle');
  btn.textContent = `Sonido: ${soundOn ? 'sí' : 'no'}`;
  btn.setAttribute('aria-pressed', String(soundOn));
}
applySound();
$('sound-toggle').addEventListener('click', () => {
  soundOn = !soundOn;
  store.set('bn_sonido', soundOn ? '1' : '0');
  applySound();
  if (soundOn) {
    unlockSound();
    clack(0.6);
  }
});
document.addEventListener('pointerdown', unlockSound, { passive: true });

// ---------- Urna (Three.js se carga aparte, para que la página aparezca enseguida) ----------

const stage = $('stage');
let realUrn = null;
const pending = { open: false, pour: null, mineColor: null };

/** Mientras la urna 3D carga (o si el dispositivo no tiene WebGL), estas funciones hacen de suplente. */
const urn = {
  target() {
    if (realUrn) return realUrn.target();
    const r = stage.getBoundingClientRect();
    return {
      mouth: { x: r.left + r.width * 0.52, y: r.top + r.height * 0.28 },
      radius: 12,
      box: { left: r.left, right: r.right, top: r.top, bottom: r.bottom },
    };
  },
  drop(color, opts) {
    if (realUrn) realUrn.drop(color, opts);
    else pending.mineColor = color;
  },
  pourTo(target, opts = {}) {
    if (realUrn) return realUrn.pourTo(target, opts);
    pending.pour = target;
    if (opts.mineColor) pending.mineColor = opts.mineColor;
    return Promise.resolve();
  },
  removeMine() {
    realUrn?.removeMine();
    pending.mineColor = null;
  },
  open(duration) {
    if (realUrn) realUrn.open(duration);
    else pending.open = true;
  },
};

let buzzed = false;
function webglAvailable() {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

async function loadUrn() {
  if (!webglAvailable()) {
    stage.classList.add('static');
    return;
  }
  try {
    const { createUrn } = await import('./urn/urn.js');
    await document.fonts.load('700 74px "Bodoni Moda Variable"').catch(() => {});
    const real = createUrn(stage, {
      onReady: () => stage.classList.add('ready'),
      onImpact(intensity, { mine }) {
        clack(intensity, mine ? 0.7 : 1);
        if (mine && !buzzed) {
          buzzed = true;
          try { navigator.vibrate?.(12); } catch { /* sin vibración */ }
        }
      },
    });
    realUrn = real;
    if (pending.open) real.open(1);
    if (pending.pour) real.pourTo(pending.pour, { mineColor: pending.mineColor, duration: 1800 });
    else if (pending.mineColor) real.drop(pending.mineColor, { mine: true });
  } catch (err) {
    console.error(err);
    stage.classList.add('static');
  }
}

/** Cuántas bolas de cada color caben en la urna para representar el resultado. */
function displayCounts(r) {
  if (r.total <= MAX_BALLS) return { blanca: r.blanca, negra: r.negra };
  let b = Math.round((MAX_BALLS * r.blanca) / r.total);
  if (r.blanca > 0 && b === 0) b = 1;
  if (r.negra > 0 && b === MAX_BALLS) b = MAX_BALLS - 1;
  return { blanca: b, negra: MAX_BALLS - b };
}

// ---------- Proposición ----------

function renderQuestion(q) {
  $('folio-num').textContent = `Año I · Núm. ${fmt.format(q.number)}`;
  $('folio-date').textContent = formatLongDate(q.day);
  $('session-num').textContent = `· Nº ${fmt.format(q.number)}${q.category ? ` · ${q.category}` : ''}`;
  const words = q.text.split(/\s+/);
  $('question').replaceChildren(...words.flatMap((word, i) => {
    const span = h('span', { class: 'w' }, word);
    span.style.animationDelay = `${80 + i * 55}ms`;
    return i < words.length - 1 ? [span, ' '] : [span];
  }));
  document.title = `${q.text} · La Bola Negra`;
}

function renderLive(total) {
  $('live').hidden = false;
  $('live-count').textContent = fmt.format(total);
  $('live-word').textContent = total === 1 ? 'persona' : 'personas';
}

// ---------- Acta ----------

const shown = { blanca: 0, negra: 0, total: 0 };
function animateNumber(key, el, to, ms) {
  const from = shown[key];
  shown[key] = to;
  if (reducedMotion || ms <= 0 || from === to) {
    el.textContent = fmt.format(to);
    return;
  }
  const start = performance.now();
  const step = (now) => {
    const u = Math.min(1, (now - start) / ms);
    el.textContent = fmt.format(Math.round(from + (to - from) * (1 - (1 - u) ** 3)));
    if (u < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

let stamped = false;
function renderActa(r, ms = 1600) {
  const pct = percents(r);
  animateNumber('blanca', $('count-blanca'), r.blanca, ms);
  animateNumber('negra', $('count-negra'), r.negra, ms);
  animateNumber('total', $('count-total'), r.total, ms);
  $('pct-blanca').textContent = percentText(r.blanca, r.total);
  $('pct-negra').textContent = percentText(r.negra, r.total);
  $('bar-blanca').style.width = `${r.total ? pct.blanca : 50}%`;
  $('bar-negra').style.width = `${r.total ? pct.negra : 50}%`;
  $('my-ball').textContent = state.myBall ? BALL_NAME[state.myBall] : '—';
  $('acta-session').textContent = `Sesión nº ${fmt.format(state.question.number)} · ${formatShortDate(state.day)}`;

  const v = verdict(r);
  const stamp = $('stamp');
  stamp.textContent = VERDICT_LABEL[v];
  stamp.className = `stamp ${v}${stamped ? ' in' : ''}`;

  let text;
  if (r.total <= 1) text = 'Su bola es la primera de la jornada. El acta se irá completando a lo largo del día.';
  else if (v === 'empate') text = `Empate a ${plural(r.blanca, 'bola', 'bolas')}: la proposición queda en el aire.`;
  else if (v === 'aprobada') text = `Queda aprobada, por ahora, con ${fmt.format(r.blanca)} bolas blancas frente a ${fmt.format(r.negra)} negras.`;
  else text = `Queda rechazada, por ahora, con ${fmt.format(r.negra)} bolas negras frente a ${fmt.format(r.blanca)} blancas.`;
  $('verdict').textContent = text;

  let caption = 'Urna abierta para el escrutinio. Su bola va marcada a lápiz rojo.';
  if (r.total > MAX_BALLS) caption += ` Cada bola representa unos ${fmt.format(Math.round(r.total / MAX_BALLS))} votos.`;
  $('caption-text').textContent = caption;
  renderLive(r.total);
}

function stampActa(delay) {
  if (stamped) return;
  setTimeout(() => {
    stamped = true;
    $('stamp').classList.add('in');
    setTimeout(thump, 160);
  }, delay);
}

async function reveal(results, myBall, { fresh }) {
  state.myBall = myBall;
  state.results = results;

  const ballot = $('ballot');
  if (!ballot.hidden) {
    ballot.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' });
    await wait(300);
    ballot.hidden = true;
  }

  urn.open(reducedMotion ? 1 : 1100);
  await wait(reducedMotion ? 0 : fresh ? 900 : 500);

  const target = displayCounts(results);
  const n = target.blanca + target.negra;
  const duration = reducedMotion ? 300 : Math.min(4200, 600 + n * 30);
  urn.pourTo(target, { mineColor: fresh ? null : myBall, duration });

  $('acta').hidden = false;
  renderActa(results, duration);
  startLiveUpdates();
  stampActa(reducedMotion ? 0 : duration * 0.6);
}

// ---------- Votar ----------

const plates = document.querySelector('.plates');
let armed = null;
let lastDragEnd = 0;

const setHint = (text) => { $('hint').textContent = text; };

function disarm() {
  armed?.classList.remove('armed');
  armed = null;
  setHint(HINT);
}

function centerOf(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, size: r.width };
}

function placeClone(el, { x, y, s }, size) {
  el.style.transform = `translate(${x - size / 2}px, ${y - size / 2}px) scale(${s})`;
}

function makeClone(ball) {
  const c = centerOf(ball);
  const el = ball.cloneNode(true);
  el.removeAttribute('aria-label');
  el.removeAttribute('data-ball');
  el.classList.remove('armed');
  el.classList.add('flying');
  el.style.width = `${c.size}px`;
  el.style.height = `${c.size}px`;
  el.setAttribute('aria-hidden', 'true');
  document.body.append(el);
  ball.classList.add('gone');
  const clone = { el, pos: { x: c.x, y: c.y, s: 1 }, size: c.size, home: c };
  placeClone(el, clone.pos, c.size);
  return clone;
}

/** Vuelo en parábola desde la mano hasta la boca de la urna. */
function flyToUrn(clone) {
  const t = urn.target();
  const from = { ...clone.pos };
  const to = { x: t.mouth.x, y: t.mouth.y, s: Math.max(0.12, (t.radius * 2) / clone.size) };
  const ctrl = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - Math.max(70, Math.abs(from.y - to.y) * 0.4) };
  const duration = reducedMotion ? 1 : 600;
  const start = performance.now();
  return new Promise((resolve) => {
    const step = (now) => {
      const u = Math.min(1, (now - start) / duration);
      const e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
      const v = 1 - e;
      placeClone(clone.el, {
        x: v * v * from.x + 2 * v * e * ctrl.x + e * e * to.x,
        y: v * v * from.y + 2 * v * e * ctrl.y + e * e * to.y,
        s: from.s + (to.s - from.s) * e,
      }, clone.size);
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

const VERIFY_HINT = 'Antes de votar, marque la casilla de abajo para confirmar que no es un robot.';

/** Pide la comprobación anti-robots cuando Turnstile no la ha resuelto solo. */
function askVerification() {
  const box = $('verificacion');
  const err = turnstileError();
  box.classList.add('attention');
  box.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
  setHint(err
    ? `No se ha podido hacer la comprobación anti-robots (código ${err}). Recargue la página e inténtelo de nuevo.`
    : VERIFY_HINT);
}

async function castBall(ball, existingClone = null) {
  if (state.busy) return;
  state.busy = true;

  // Sin comprobación anti-robots resuelta no se lanza la bola: se pide antes.
  let verification = null;
  if (turnstileActive()) {
    verification = await turnstileToken(2500);
    if (!verification) {
      if (existingClone) returnHome(existingClone, ball);
      disarm();
      askVerification();
      state.busy = false;
      return;
    }
  }
  // En móvil la urna puede quedar fuera de la pantalla: primero se acerca, para ver caer la bola.
  if (!existingClone) {
    const r = stage.getBoundingClientRect();
    if (r.top < 0 || r.top + r.height * 0.6 > window.innerHeight) {
      stage.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
      await wait(reducedMotion ? 50 : 550);
    }
  }
  const clone = existingClone ?? makeClone(ball);
  const color = ball.dataset.ball;
  disarm();
  plates.classList.add('disabled');
  setHint('Su bola cae en la urna…');

  await flyToUrn(clone);
  clone.el.remove();
  urn.drop(color, { mine: true });

  const [res] = await Promise.all([
    api('/api/votar', { method: 'POST', body: { ball: color, day: state.day, turnstileToken: verification ?? undefined } }),
    wait(reducedMotion ? 300 : 1400),
  ]);
  resetTurnstile();

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
    setTimeout(() => location.reload(), 2200);
    return;
  }

  // El voto no ha entrado: la bola vuelve a la mano.
  toast(res.data.detalle ? `${res.data.error} (código ${res.data.detalle})` : (res.data.error ?? 'No se ha podido registrar su voto.'));
  urn.removeMine();
  ball.classList.remove('gone');
  plates.classList.remove('disabled');
  setHint(HINT);
  state.busy = false;
}

function setupBallot() {
  let drag = null;

  for (const ball of document.querySelectorAll('.ball[data-ball]')) {
    ball.addEventListener('click', () => {
      if (state.busy || performance.now() - lastDragEnd < 400) return;
      unlockSound();
      if (armed === ball) {
        castBall(ball);
        return;
      }
      armed?.classList.remove('armed');
      armed = ball;
      ball.classList.add('armed');
      setHint(`¿${BALL_NAME[ball.dataset.ball].replace(/^./, (c) => c.toUpperCase())}? Púlsela otra vez para depositarla.`);
    });

    ball.addEventListener('pointerdown', (e) => {
      if (state.busy || e.button > 0) return;
      drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, clone: null };
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
      c.pos = { x: c.home.x + dx, y: c.home.y + dy, s: 1.06 };
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
        castBall(ball, d.clone);
      } else {
        returnHome(d.clone, ball);
        setHint('Suelte la bola encima de la urna para votar.');
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

// ---------- Cuenta atrás y directo ----------

function startCountdown(ms) {
  const endAt = Date.now() + ms;
  const el = $('countdown');
  let reloading = false;
  const tick = () => {
    const left = Math.max(0, endAt - Date.now());
    const s = Math.floor(left / 1000);
    const hh = Math.floor(s / 3600);
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    el.textContent = `${hh} h ${mm} min ${ss} s`;
    el.dateTime = `PT${s}S`;
    if (left === 0 && !reloading) {
      reloading = true;
      toast('Se abre una nueva sesión.');
      setTimeout(() => location.reload(), 1500);
    }
  };
  tick();
  setInterval(tick, 1000);
}

// Actualización en directo del acta: solo tras votar, con la pestaña visible y durante un rato.
// Así una visita normal hace pocas peticiones y la API cabe holgada en el plan gratuito.
const LIVE_EVERY = 45_000;
const LIVE_MAX = 40; // unos 30 minutos
let liveTimer = null;
let livePolls = 0;

function startLiveUpdates() {
  if (liveTimer) return;
  liveTimer = setInterval(async () => {
    if (document.hidden) return;
    if (++livePolls > LIVE_MAX) {
      clearInterval(liveTimer);
      return;
    }
    const { ok, data } = await api('/api/hoy');
    if (!ok) return;
    if (data.question.day !== state.day) {
      location.reload();
      return;
    }
    renderLive(data.totalVotes);
    if (data.results && data.results.total !== state.results.total) {
      state.results = data.results;
      renderActa(data.results, 900);
      urn.pourTo(displayCounts(data.results), { duration: 1600 });
    }
  }, LIVE_EVERY);
}

// ---------- Compartir ----------

$('share').addEventListener('click', async () => {
  const url = new URL('./', location.href).href;
  const text = `Proposición de hoy en La Bola Negra: «${state.question.text}» Yo ya he depositado mi bola. ¿Blanca o negra?`;
  if (navigator.share) {
    try { await navigator.share({ title: 'La Bola Negra', text, url }); } catch { /* cancelado */ }
    return;
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    toast('Enlace copiado. Páselo a quien quiera.');
  } catch {
    toast(url);
  }
});

// ---------- Libro de actas ----------

async function loadActas() {
  $('download-csv').href = downloadUrl('csv');
  $('download-json').href = downloadUrl('json');
  const body = $('actas-body');
  const { ok, data } = await api('/api/archivo?limite=7');
  if (!ok) {
    body.replaceChildren(h('tr', {}, h('td', { colspan: 6, class: 'actas-empty' }, 'No se ha podido abrir el libro de actas.')));
    return;
  }
  if (!data.items.length) {
    body.replaceChildren(h('tr', {}, h('td', { colspan: 6, class: 'actas-empty' }, 'Hoy se celebra la primera sesión. Mañana aparecerá aquí su acta.')));
    return;
  }
  body.replaceChildren(...data.items.map(actaRow));
}

// ---------- Arranque ----------

async function init() {
  loadUrn();
  const { ok, data } = await api('/api/hoy');
  if (!ok) {
    $('question').replaceChildren(h('span', { class: 'question-wait' }, data.error ?? 'No se ha podido abrir la sesión.'));
    return;
  }
  state.day = data.question.day;
  state.question = data.question;
  renderQuestion(data.question);
  renderLive(data.totalVotes);
  startCountdown(data.nextInMs);

  if (data.myBall) {
    $('deck').hidden = true;
    reveal(data.results, data.myBall, { fresh: false });
  } else {
    $('ballot').hidden = false;
    setupBallot();
    setupTurnstile(data.turnstileSiteKey, $('verificacion'), {
      onInteractive() {
        $('verificacion').classList.add('attention');
        setHint(VERIFY_HINT);
      },
      onStatus({ token }) {
        if (token && $('hint').textContent === VERIFY_HINT) {
          $('verificacion').classList.remove('attention');
          setHint('Comprobación hecha. Ya puede depositar su bola.');
        }
      },
    });
  }
  loadActas();
}

init();
