// Todo el calendario va con la hora peninsular española.
const TZ = 'Europe/Madrid';

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const clockFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

/** Día actual en Madrid, YYYY-MM-DD. */
export function madridDay(now = new Date()) {
  return dayFmt.format(now);
}

/** Milisegundos que faltan para la medianoche en Madrid. */
export function msUntilNextDay(now = new Date()) {
  const [h, m, s] = clockFmt.format(now).split(':').map(Number);
  return Math.max(1000, 86_400_000 - ((h * 3600 + m * 60 + s) * 1000 + now.getMilliseconds()));
}

export function isDay(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
