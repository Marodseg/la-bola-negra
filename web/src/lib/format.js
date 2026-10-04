export const fmt = new Intl.NumberFormat('es-ES');

const longDate = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortDate = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

const asDate = (day) => new Date(`${day}T12:00:00Z`);
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** «Domingo, 4 de octubre de 2026» */
export const formatLongDate = (day) => capital(longDate.format(asDate(day)));
/** «4 oct 2026» */
export const formatShortDate = (day) => shortDate.format(asDate(day)).replace('.', '');

const ROMAN = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
export function roman(n) {
  let out = '';
  for (const [v, s] of ROMAN) for (; n >= v; n -= v) out += s;
  return out;
}

export function percents({ blanca, total }) {
  if (!total) return { blanca: 0, negra: 0 };
  const b = Math.round((100 * blanca) / total);
  return { blanca: b, negra: 100 - b };
}

const pct1 = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
/** Porcentaje con un decimal («49,6 %»), para que un resultado ajustado no parezca un empate. */
export function percentText(part, total) {
  return total ? `${pct1.format((100 * part) / total)} %` : '0 %';
}

/** 'aprobada' | 'rechazada' | 'empate' */
export function verdict({ blanca, negra }) {
  if (blanca === negra) return 'empate';
  return blanca > negra ? 'aprobada' : 'rechazada';
}

export const VERDICT_LABEL = { aprobada: 'Aprobada', rechazada: 'Rechazada', empate: 'Empate' };

export function plural(n, one, many) {
  return `${fmt.format(n)} ${n === 1 ? one : many}`;
}
