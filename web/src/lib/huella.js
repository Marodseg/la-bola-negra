// Huella técnica del dispositivo: datos que no cambian al abrir una ventana de incógnito
// ni al borrar la caché (navegador, pantalla, idioma, zona horaria, gráfica).
// Se envía resumida en SHA-256 y el servidor la guarda solo como HMAC junto con la IP y la fecha.

function gpu() {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const out = ext ? `${gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)}|${gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)}` : '';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return out;
  } catch {
    return '';
  }
}

let cached = null;

/** SHA-256 en hexadecimal (64 caracteres) de los rasgos estables del dispositivo. */
export function deviceFingerprint() {
  if (cached) return cached;
  const s = window.screen;
  const parts = [
    navigator.userAgent,
    navigator.language,
    (navigator.languages ?? []).join(','),
    navigator.platform,
    navigator.hardwareConcurrency ?? '',
    navigator.deviceMemory ?? '',
    navigator.maxTouchPoints ?? '',
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    `${s.width}x${s.height}x${s.colorDepth}@${window.devicePixelRatio}`,
    gpu(),
  ];
  const data = new TextEncoder().encode(parts.join('¦'));
  cached = crypto.subtle.digest('SHA-256', data)
    .then((buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join(''))
    .catch(() => null);
  return cached;
}
