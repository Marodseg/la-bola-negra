// Cloudflare Turnstile: comprobación anti-bots, sin cookies y casi siempre invisible.
let widget = null;
let token = null;
let waiters = [];

function loadScript() {
  return new Promise((resolve, reject) => {
    if (window.turnstile) return resolve();
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = resolve;
    s.onerror = reject;
    document.head.append(s);
  });
}

export async function setupTurnstile(siteKey, container) {
  if (!siteKey) return;
  try {
    await loadScript();
    widget = window.turnstile.render(container, {
      sitekey: siteKey,
      appearance: 'interaction-only',
      language: 'es',
      callback(t) {
        token = t;
        waiters.forEach((w) => w(t));
        waiters = [];
      },
      'expired-callback'() { token = null; },
    });
  } catch {
    widget = null;
  }
}

/** Devuelve un token válido (o null si Turnstile no está activo o tarda demasiado). */
export function turnstileToken(timeout = 12000) {
  if (widget === null) return Promise.resolve(null);
  if (token) return Promise.resolve(token);
  return new Promise((resolve) => {
    waiters.push(resolve);
    setTimeout(() => resolve(null), timeout);
  });
}

/** Cada token sirve una sola vez. */
export function resetTurnstile() {
  token = null;
  if (widget !== null) window.turnstile?.reset(widget);
}
