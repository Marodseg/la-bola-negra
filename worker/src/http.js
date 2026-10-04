const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

export function allowedOrigins(env) {
  return (env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
}

export function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin || !allowedOrigins(env).includes(origin)) return { Vary: 'Origin' };
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Votante, X-Huella',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function json(data, { status = 200, cache = 'no-store', headers = {} } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cache,
      ...SECURITY_HEADERS,
      ...headers,
    },
  });
}

export function text(body, contentType, { cache = 'no-store', headers = {} } = {}) {
  return new Response(body, {
    headers: { 'Content-Type': contentType, 'Cache-Control': cache, ...SECURITY_HEADERS, ...headers },
  });
}

export const error = (status, message, extra = {}) => json({ error: message, ...extra }, { status });

/** Lee un JSON pequeño del cuerpo de la petición; null si no es válido. */
export async function readJson(request, maxBytes = 2048) {
  const length = Number(request.headers.get('Content-Length') ?? 0);
  if (length > maxBytes) return null;
  const raw = await request.text();
  if (raw.length > maxBytes) return null;
  try {
    const data = JSON.parse(raw);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}
