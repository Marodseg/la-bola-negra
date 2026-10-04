const HISTORY_SQL = `
  SELECT q.day, q.number, q.text, q.category, q.source,
         COALESCE(t.blanca, 0) AS blanca, COALESCE(t.negra, 0) AS negra
  FROM questions q LEFT JOIN tallies t ON t.day = q.day
  WHERE q.day < ?1 AND (?2 IS NULL OR q.day < ?2)
  ORDER BY q.day DESC
  LIMIT ?3`;

/** Votaciones cerradas (anteriores a `today`), de la más reciente a la más antigua. */
export async function closedSessions(db, today, { before = null, limit = 1000 } = {}) {
  const { results } = await db.prepare(HISTORY_SQL).bind(today, before, limit).all();
  return results.map((r) => ({
    day: r.day,
    number: r.number,
    text: r.text,
    category: r.category,
    source: r.source,
    results: { blanca: r.blanca, negra: r.negra, total: r.blanca + r.negra },
  }));
}

export function verdict({ blanca, negra }) {
  if (blanca === negra) return 'empate';
  return blanca > negra ? 'aprobada' : 'rechazada';
}

function csvCell(value) {
  const s = String(value ?? '');
  // Evita que Excel interprete celdas como fórmulas (inyección CSV).
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(sessions) {
  const header = ['numero', 'fecha', 'pregunta', 'categoria', 'origen', 'bolas_blancas', 'bolas_negras', 'total', 'resultado'];
  const rows = sessions.map((s) => [
    s.number, s.day, s.text, s.category, s.source, s.results.blanca, s.results.negra, s.results.total, verdict(s.results),
  ]);
  // BOM para que Excel abra bien las tildes.
  return `\uFEFF${[header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
