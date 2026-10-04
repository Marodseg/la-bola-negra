// Imitación mínima de la API de Cloudflare D1 sobre node:sqlite, para probar el Worker sin red.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

class Statement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new Statement(this.db, this.sql, params);
  }

  async first(column) {
    const row = this.db.prepare(this.sql).get(...this.params) ?? null;
    return row && column ? row[column] : row;
  }

  async all() {
    return { results: this.db.prepare(this.sql).all(...this.params), success: true };
  }

  async run() {
    // Como D1: `changes` incluye las filas que modifican los triggers.
    const total = () => Number(this.db.prepare('SELECT total_changes() AS n').get().n);
    const before = total();
    this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: total() - before } };
  }
}

export function createD1() {
  const db = new DatabaseSync(':memory:');
  const dir = path.resolve(import.meta.dirname, '../worker/migrations');
  for (const file of fs.readdirSync(dir).sort()) db.exec(fs.readFileSync(path.join(dir, file), 'utf8'));
  return {
    prepare: (sql) => new Statement(db, sql),
    exec: async (sql) => db.exec(sql),
    raw: db,
  };
}
