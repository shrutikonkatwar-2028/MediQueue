const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { JWT_SECRET } = require('../config');
const { h, httpError, EMAIL_RE, PHONE_RE, now, validDob, strongPassword, str } = require('../utils/helpers');
const { auth } = require('../middleware/auth');
const { audit } = require('../utils/audit');

// Small in-memory rate limiter (30 attempts / 15 minutes / IP)
const attempts = new Map();
function limiter(req, res, next) {
  const t = Date.now();
  const recent = (attempts.get(req.ip) || []).filter(x => t - x < 15 * 60 * 1000);
  if (recent.length >= 30) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes' });
  recent.push(t);
  attempts.set(req.ip, recent);
  next();
}

const session = u => ({
  token: jwt.sign({ id: u.id, role: u.role, name: u.name }, JWT_SECRET, { expiresIn: '8h' }),
  user: { id: u.id, name: u.name, role: u.role }
});

const BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const PASSWORD_RULE = 'Password must be at least 8 characters and contain a letter and a number';

router.post('/register', limiter, h(async (req, res) => {
  const b = req.body || {};
  const name = str(b.name, 80), email = str(b.email, 120).toLowerCase(), phone = str(b.phone, 20);
  if (name.length < 2) throw httpError(400, 'Enter your full name');
  if (!EMAIL_RE.test(email)) throw httpError(400, 'Enter a valid email address');
  if (phone && !PHONE_RE.test(phone)) throw httpError(400, 'Enter a valid phone number');
  if (!strongPassword(b.password)) throw httpError(400, PASSWORD_RULE);
  if (!validDob(b.dob)) throw httpError(400, 'Enter a valid date of birth');
  if (await db.get('SELECT id FROM users WHERE email = ?', [email])) throw httpError(409, 'This email is already registered');

  const hash = await bcrypt.hash(b.password, 10);
  const id = await db.tx(async t => {
    const u = await t.run('INSERT INTO users (name,email,phone,password,role,created_at) VALUES (?,?,?,?,?,?)',
      [name, email, phone || null, hash, 'patient', now()]);
    await t.run(
      `INSERT INTO patients (user_id,dob,gender,blood_group,medical_history,allergies,chronic_flag,address,emergency_contact)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [u.insertId, b.dob, ['Male', 'Female', 'Other'].includes(b.gender) ? b.gender : null,
       BLOOD.includes(b.blood_group) ? b.blood_group : null, str(b.medical_history, 500) || null,
       str(b.allergies, 200) || null, b.chronic_flag ? 1 : 0, str(b.address, 200) || null,
       str(b.emergency_contact, 100) || null]);
    return u.insertId;
  });
  await audit({ user: { id }, ip: req.ip }, 'REGISTER', email);
  res.status(201).json(session({ id, name, role: 'patient' }));
}));

router.post('/login', limiter, h(async (req, res) => {
  const email = str((req.body || {}).email, 120).toLowerCase();
  const password = String((req.body || {}).password || '');
  const u = await db.get('SELECT * FROM users WHERE email = ?', [email]);
  if (!u || !(await bcrypt.compare(password, u.password))) {
    await audit({ user: u ? { id: u.id } : null, ip: req.ip }, 'LOGIN_FAILED', email);
    throw httpError(401, 'Wrong email or password');
  }
  if (!u.is_active) throw httpError(403, 'This account is disabled. Please contact the hospital admin');
  await db.run('UPDATE users SET last_login = ? WHERE id = ?', [now(), u.id]);
  await audit({ user: { id: u.id }, ip: req.ip }, 'LOGIN', email);
  res.json(session(u));
}));

router.get('/me', auth, h(async (req, res) => {
  const u = await db.get('SELECT id,name,email,phone,role,last_login FROM users WHERE id = ?', [req.user.id]);
  if (!u) throw httpError(401, 'Account not found');
  res.json(u);
}));

router.post('/change-password', auth, h(async (req, res) => {
  const b = req.body || {};
  const u = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!u || !(await bcrypt.compare(String(b.current_password || ''), u.password))) {
    throw httpError(400, 'Current password is wrong');
  }
  if (!strongPassword(b.new_password)) throw httpError(400, PASSWORD_RULE);
  await db.run('UPDATE users SET password = ? WHERE id = ?', [await bcrypt.hash(b.new_password, 10), u.id]);
  await audit(req, 'PASSWORD_CHANGED', u.email);
  res.json({ ok: true });
}));

module.exports = router;
