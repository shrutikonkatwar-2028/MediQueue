// SQLite driver (zero setup: one file on disk). Same async API as the MySQL driver.
const fs = require('fs');
const path = require('path');
const { SQLITE_FILE } = require('../config');

let Database;
try { Database = require('better-sqlite3'); } catch (e) {
  console.error('\nThe "better-sqlite3" package is not installed. Run:  npm install\n');
  throw e;
}

fs.mkdirSync(path.dirname(SQLITE_FILE), { recursive: true });
const db = new Database(SQLITE_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Same rules as the MySQL driver: '2026-10-08 02:50:39' (UTC) -> '2026-10-08T02:50:39Z'
const DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/;
function normRow(r) {
  const o = {};
  for (const k of Object.keys(r)) {
    const v = r[k];
    o[k] = typeof v === 'string' && DATETIME_RE.test(v) ? v.replace(' ', 'T') + 'Z' : v;
  }
  return o;
}
function param(v) {
  if (v instanceof Date) return v.toISOString().replace('T', ' ').replace('Z', '');   // stored in UTC
  if (v === true) return 1;
  if (v === false) return 0;
  if (v === undefined) return null;
  return v;
}
function prep(sql, params) {
  const stmt = db.prepare(sql.replace(/\s+FOR UPDATE\b/gi, ''));   // row locks are not needed in SQLite
  return { stmt, p: (params || []).map(param) };
}

const api = {
  inTx: false,
  async all(sql, params) { const { stmt, p } = prep(sql, params); return stmt.all(...p).map(normRow); },
  async get(sql, params) { const { stmt, p } = prep(sql, params); const r = stmt.get(...p); return r ? normRow(r) : undefined; },
  async run(sql, params) {
    const { stmt, p } = prep(sql, params);
    const r = stmt.run(...p);
    return { insertId: Number(r.lastInsertRowid), affectedRows: r.changes };
  }
};

// Everything inside a transaction only awaits SQLite calls (which finish instantly), so no other
// request can slip in between BEGIN and COMMIT.
let txChain = Promise.resolve();
function tx(fn) {
  const job = txChain.then(async () => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = await fn({ ...api, inTx: true });
      db.exec('COMMIT');
      return result;
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch { /* ignore */ }
      throw e;
    }
  });
  txChain = job.catch(() => {});
  return job;
}

// MySQL schema.sql -> SQLite
const toSqlite = sql => sql
  .replace(/ENGINE=InnoDB DEFAULT CHARSET=utf8mb4/g, '')
  .replace(/,\s*(?:INDEX|KEY)\s+\w+\s*\([^)]*\)/g, '')
  .replace(/UNIQUE KEY \w+/g, 'UNIQUE')
  .replace(/INT AUTO_INCREMENT PRIMARY KEY/g, 'INTEGER PRIMARY KEY AUTOINCREMENT')
  .replace(/ENUM\([^)]*\)/g, 'TEXT')
  .replace(/DECIMAL\(\d+,\d+\)/g, 'REAL')
  .replace(/TINYINT\(1\)/g, 'INTEGER').replace(/TINYINT/g, 'INTEGER');

const INDEXES = `
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_doctor_date_status ON appointments(doctor_id, date, status);
CREATE INDEX IF NOT EXISTS idx_patient_status ON appointments(patient_id, status);
CREATE INDEX IF NOT EXISTS idx_bills_status ON bills(status);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);`;

module.exports = {
  ...api,
  tx,
  initSchema(schemaSql) { db.exec(toSqlite(schemaSql)); db.exec(INDEXES); },
  async clearAll(tables) {
    db.pragma('foreign_keys = OFF');
    try {
      for (const t of tables) { db.exec(`DELETE FROM \`${t}\``); }
      db.exec('DELETE FROM sqlite_sequence');
    } finally { db.pragma('foreign_keys = ON'); }
  },
  close: async () => db.close()
};
