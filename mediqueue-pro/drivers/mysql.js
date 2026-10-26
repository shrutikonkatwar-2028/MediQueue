// MySQL access layer. All queries are async: await db.get / db.all / db.run / db.tx
const mysql = require('mysql2/promise');
const { DB } = require('../config');

const pool = mysql.createPool({
  ...DB,
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
  timezone: 'Z',          // all DATETIME values are stored in UTC
  dateStrings: true,      // DATE / DATETIME come back as strings, never JS Date objects
  decimalNumbers: true    // DECIMAL columns come back as numbers
});

// '2026-10-08 02:50:39' (UTC) -> '2026-10-08T02:50:39Z' so the browser and Date.parse understand it
const DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/;
function normRow(r) {
  const o = {};
  for (const k of Object.keys(r)) {
    const v = r[k];
    o[k] = v instanceof Date ? v.toISOString()
         : typeof v === 'string' && DATETIME_RE.test(v) ? v.replace(' ', 'T') + 'Z' : v;
  }
  return o;
}

function wrap(conn, inTx) {
  return {
    inTx,
    async all(sql, params = []) { const [rows] = await conn.query(sql, params); return rows.map(normRow); },
    async get(sql, params = []) { const [rows] = await conn.query(sql, params); return rows[0] ? normRow(rows[0]) : undefined; },
    async run(sql, params = []) {
      const [r] = await conn.query(sql, params);
      return { insertId: r.insertId, affectedRows: r.affectedRows };
    }
  };
}

const base = wrap(pool, false);

module.exports = {
  ...base,
  // Run several queries as one all-or-nothing transaction
  async tx(fn) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await fn(wrap(conn, true));
      await conn.commit();
      return result;
    } catch (e) {
      try { await conn.rollback(); } catch { /* ignore */ }
      throw e;
    } finally {
      conn.release();
    }
  },
  // Used by seed.js only: empties tables while ignoring foreign keys
  async clearAll(tables) {
    const conn = await pool.getConnection();
    try {
      await conn.query('SET FOREIGN_KEY_CHECKS = 0');
      for (const t of tables) await conn.query(`TRUNCATE TABLE \`${t}\``);
      await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    } finally { conn.release(); }
  },
  close: () => pool.end()
};
