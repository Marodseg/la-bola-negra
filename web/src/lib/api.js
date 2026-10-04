import { store } from './store.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Raíz de la API: en producción, el Worker de Cloudflare; en desarrollo, el proxy de Vite. */
export const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Identificador aleatorio de este navegador. No es un dato personal: no dice quién eres,
 * solo sirve para que no se pueda votar dos veces. El servidor solo guarda su huella (HMAC).
 */
export const voterId = (() => {
  let id = store.get('bn_votante');
  if (!id || !UUID_RE.test(id)) {
    id = uuid();
    store.set('bn_votante', id);
  }
  return id;
})();

export async function api(path, { method = 'GET', body, timeout = 12000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      mode: 'cors',
      credentials: 'omit',
      signal: ctrl.signal,
      headers: { 'X-Votante': voterId, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: 'No hay conexión con la urna. Inténtelo de nuevo en un momento.' } };
  } finally {
    clearTimeout(timer);
  }
}

export const downloadUrl = (format) => `${API_URL}/api/historico.${format}`;
