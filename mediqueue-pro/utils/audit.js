const db = require('../db');
const { now } = require('./helpers');

// Writes a line to audit_logs. Never throws (a logging problem must not break the request).
async function audit(req, action, details = '') {
  try {
    await db.run(
      'INSERT INTO audit_logs (user_id, action, details, ip, created_at) VALUES (?,?,?,?,?)',
      [req && req.user ? req.user.id : null, action, String(details).slice(0, 255),
       req && req.ip ? String(req.ip).slice(0, 45) : null, now()]
    );
  } catch (e) { console.error('audit log failed:', e.message); }
}
module.exports = { audit };
