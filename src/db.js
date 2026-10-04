import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const BALLS = ['blanca', 'negra'];

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS votes (
      day        TEXT    NOT NULL,
      voter      TEXT    NOT NULL,
      device     TEXT,
      ip_hash    TEXT    NOT NULL,
      ball       TEXT    NOT NULL CHECK (ball IN ('blanca', 'negra')),
      created_at INTEGER NOT NULL,
      PRIMARY KEY (day, voter)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS votes_day_device ON votes(day, device) WHERE device IS NOT NULL;
    CREATE INDEX IF NOT EXISTS votes_day_ip ON votes(day, ip_hash);
  `);

  const q = {
    find: db.prepare(`SELECT ball FROM votes WHERE day = ? AND (voter = ? OR device = ?) LIMIT 1`),
    insert: db.prepare(`INSERT OR IGNORE INTO votes (day, voter, device, ip_hash, ball, created_at) VALUES (?, ?, ?, ?, ?, ?)`),
    byIp: db.prepare(`SELECT COUNT(*) AS n FROM votes WHERE day = ? AND ip_hash = ?`),
    tally: db.prepare(`SELECT ball, COUNT(*) AS n FROM votes WHERE day = ? GROUP BY ball`),
  };

  return {
    /** Bola que ya echó este votante (o este dispositivo) ese día, o null. */
    findVote(day, voter, device) {
      return q.find.get(day, voter, device ?? '\0')?.ball ?? null;
    },
    votesFromIp(day, ipHash) {
      return q.byIp.get(day, ipHash).n;
    },
    /** Devuelve true si el voto entra; false si ya había uno de ese votante o dispositivo. */
    castVote({ day, voter, device, ipHash, ball }) {
      return q.insert.run(day, voter, device ?? null, ipHash, ball, Date.now()).changes === 1;
    },
    tally(day) {
      const out = { blanca: 0, negra: 0, total: 0 };
      for (const row of q.tally.all(day)) {
        out[row.ball] = row.n;
        out.total += row.n;
      }
      return out;
    },
    close() { db.close(); },
  };
}
