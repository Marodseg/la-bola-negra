// Cloudflare Turnstile: comprobación anti-bots sin cookies ni rompecabezas.
// Si no hay TURNSTILE_SECRET configurado, no se exige.
// Devuelve { ok, codes } con los códigos de error de Cloudflare para poder diagnosticar.
export async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return { ok: true, codes: [] };
  if (typeof token !== 'string' || !token || token.length > 2048) return { ok: false, codes: ['sin-token'] };
  const body = new FormData();
  body.append('secret', env.TURNSTILE_SECRET);
  body.append('response', token);
  if (ip) body.append('remoteip', ip);
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
    const data = await res.json();
    const codes = Array.isArray(data['error-codes']) ? data['error-codes'].map(String).slice(0, 3) : [];
    if (data.success !== true) console.warn(`Turnstile rechazado: ${codes.join(',') || 'sin código'}`);
    return { ok: data.success === true, codes };
  } catch {
    return { ok: false, codes: ['sin-conexion'] };
  }
}
