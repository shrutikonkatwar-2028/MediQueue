const jwt = require('jsonwebtoken');
const db = require('../db');
const { JWT_SECRET } = require('../config');

// Remember "is this user still active?" for 30 seconds so we do not hit the DB on every request
const activeCache = new Map();
const invalidateUser = id => activeCache.delete(id);

async function isActive(id) {
  const hit = activeCache.get(id);
  if (hit && Date.now() - hit.at < 30000) return hit.active;
  const u = await db.get('SELECT is_active FROM users WHERE id = ?', [id]);
  const active = !!(u && u.is_active);
  activeCache.set(id, { active, at: Date.now() });
  return active;
}

async function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Please log in' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Session expired. Please log in again' });
  }
  try {
    if (!(await isActive(req.user.id))) return res.status(401).json({ error: 'This account is disabled' });
    next();
  } catch (e) { next(e); }
}

// Role-based access: patients cannot call doctor/admin APIs, etc.
const role = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Access denied' });

module.exports = { auth, role, invalidateUser };
