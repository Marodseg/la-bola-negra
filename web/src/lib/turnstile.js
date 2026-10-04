// Cloudflare Turnstile: comprobación anti-bots, sin cookies y casi siempre invisible.
// En modo «Managed», a veces pide marcar una casilla: la web lo detecta y lo explica.
let widget = null;
let token = null;
let lastError = null;
let waiters = [];
let onChange = () => {};

const notify = () => onChange({ token, error: lastError });

// Ojo: un elemento con id="turnstile" crearía una variable global window.turnstile que no es
// la librería; por eso se comprueba que exista de verdad la función render.
const loaded = () => typeof window.turnstile?.render === 'function';

function loadScript() {
  return new Promise((resolve, reject) => {
    if (loaded()) return resolve();
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => (loaded() ? resolve() : reject(new Error('no-carga')));
    s.onerror = () => reject(new Error('no-carga'));
    document.head.append(s);
  });
}

/**
 * @param {string|null} siteKey
 * @param {HTMLElement} container
 * @param {{ onInteractive?: () => void, onStatus?: (s: { token: string|null, error: string|null }) => void }} [hooks]
 */
export async function setupTurnstile(siteKey, container, { onInteractive, onStatus } = {}) {
  if (!siteKey) return;
  if (onStatus) onChange = onStatus;
  widget = 'cargando';
  try {
    await loadScript();
    widget = window.turnstile.render(container, {
      sitekey: siteKey,
      appearance: 'interaction-only',
      language: 'es',
      'refresh-expired': 'auto',
      callback(t) {
        token = t;
        lastError = null;
        waiters.forEach((w) => w(t));
        waiters = [];
        notify();
      },
      'expired-callback'() {
        token = null;
        notify();
      },
      'before-interactive-callback'() {
        onInteractive?.();
      },
      'error-callback'(code) {
        token = null;
        lastError = String(code ?? 'desconocido');
        notify();
      },
    });
  } catch (err) {
    widget = null;
    lastError = err?.message ?? 'no-carga';
    notify();
  }
}

export const turnstileActive = () => widget !== null;
export const turnstileError = () => lastError;

/** Devuelve un token válido, o null si Turnstile no está activo o no lo consigue a tiempo. */
export function turnstileToken(timeout = 3000) {
  if (widget === null) return Promise.resolve(null);
  if (token) return Promise.resolve(token);
  return new Promise((resolve) => {
    waiters.push(resolve);
    setTimeout(() => resolve(token), timeout);
  });
}

/** Cada token sirve una sola vez. */
export function resetTurnstile() {
  token = null;
  if (widget !== null && widget !== 'cargando') window.turnstile?.reset(widget);
}
