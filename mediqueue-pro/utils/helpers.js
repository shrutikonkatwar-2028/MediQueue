const pad = n => String(n).padStart(2, '0');

function localDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
const now = () => new Date();
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// Wrap async route handlers: thrown httpErrors become clean JSON responses
const h = fn => (req, res, next) => {
  Promise.resolve().then(() => fn(req, res, next)).catch(e => {
    if (e.status) return res.status(e.status).json({ error: e.message });
    if (e.code === 'ER_DUP_ENTRY' || e.code === 'SQLITE_CONSTRAINT_UNIQUE' || e.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') return res.status(409).json({ error: 'This record already exists' });
    next(e);
  });
};

const DOCTOR_STATUSES = ['In OPD', 'In surgery', 'On break', 'On ward round', 'Not in hospital'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+\-\s]{7,15}$/;

function ageFromDob(dob) {
  if (!dob) return 0;
  const [y, m, d] = String(dob).slice(0, 10).split('-').map(Number);
  const t = new Date();
  let age = t.getFullYear() - y;
  if (t.getMonth() + 1 < m || (t.getMonth() + 1 === m && t.getDate() < d)) age--;
  return Math.max(0, age);
}
function dobFromAge(age) {
  const t = new Date();
  return localDate(new Date(t.getFullYear() - age, t.getMonth(), t.getDate()));
}
function validDob(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
  return !isNaN(new Date(s + 'T00:00:00')) && s <= localDate() && ageFromDob(s) <= 120;
}
const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && !isNaN(new Date(s + 'T00:00:00'));
const strongPassword = p => typeof p === 'string' && p.length >= 8 && p.length <= 72 && /[A-Za-z]/.test(p) && /\d/.test(p);

// Input helpers
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
function optNum(v, min, max, label) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw httpError(400, `${label} looks wrong`);
  return n;
}

function toCsv(rows, cols) {
  const cell = v => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@]/.test(s)) s = "'" + s;           // stop spreadsheet formula injection
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [cols.join(','), ...rows.map(r => cols.map(c => cell(r[c])).join(','))].join('\n');
}

module.exports = {
  localDate, addDays, now, WEEKDAYS, httpError, h, DOCTOR_STATUSES, EMAIL_RE, PHONE_RE,
  ageFromDob, dobFromAge, validDob, validDate, strongPassword, str, optNum, toCsv
};
