const encoder = new TextEncoder();
const keys = new Map();

async function hmacKey(secret) {
  if (!keys.has(secret)) {
    keys.set(secret, crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']));
  }
  return keys.get(secret);
}

/** HMAC-SHA256 en base64url, recortado a `length` caracteres. */
export async function hmac(secret, value, length = 32) {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(value));
  let bin = '';
  for (const byte of new Uint8Array(sig)) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, length);
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
