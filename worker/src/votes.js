export const BALLS = ['blanca', 'negra'];

export async function tally(db, day) {
  const row = await db.prepare('SELECT blanca, negra FROM tallies WHERE day = ?').bind(day).first();
  const blanca = row?.blanca ?? 0;
  const negra = row?.negra ?? 0;
  return { blanca, negra, total: blanca + negra };
}

/** Bola que ya echó este votante, o este mismo dispositivo desde la misma conexión, ese día. */
export async function findVote(db, day, voter, deviceKey = null) {
  const row = await db.prepare('SELECT ball FROM votes WHERE day = ? AND (voter = ? OR device_key = ?) LIMIT 1')
    .bind(day, voter ?? '', deviceKey ?? '').first();
  return row?.ball ?? null;
}

export async function votesFromIp(db, day, ipHash) {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM votes WHERE day = ? AND ip_hash = ?').bind(day, ipHash).first();
  return row?.n ?? 0;
}

/** true si el voto entra; false si ese votante (o ese dispositivo en esa conexión) ya había votado. */
export async function castVote(db, { day, voter, deviceKey, ipHash, ball }) {
  const res = await db.prepare('INSERT OR IGNORE INTO votes (day, voter, device_key, ip_hash, ball, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(day, voter, deviceKey, ipHash, ball, Date.now()).run();
  // En D1, `changes` también cuenta las filas que toca el trigger del recuento.
  return res.meta.changes > 0;
}

/** Bolas que echó un votante en varios días: { 'YYYY-MM-DD': 'blanca' | 'negra' }. */
export async function votesOf(db, voter, days) {
  if (!voter || !days.length) return {};
  const marks = days.map(() => '?').join(', ');
  const { results } = await db.prepare(`SELECT day, ball FROM votes WHERE voter = ? AND day IN (${marks})`)
    .bind(voter, ...days).all();
  return Object.fromEntries(results.map((r) => [r.day, r.ball]));
}
