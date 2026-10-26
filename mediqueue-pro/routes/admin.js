const router = require('express').Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');
const { auth, role, invalidateUser } = require('../middleware/auth');
const { h, httpError, localDate, addDays, now, EMAIL_RE, PHONE_RE, strongPassword, str, optNum, toCsv, ageFromDob } = require('../utils/helpers');
const { totalScore } = require('../utils/priority');
const { getAllSchedules, saveSchedule } = require('../utils/schedule');
const { audit } = require('../utils/audit');
const { broadcast, announce } = require('../realtime');

router.use(auth, role('admin'));

router.get('/overview', h(async (req, res) => {
  const today = localDate();
  const c = async (sql, p = [today]) => (await db.get(sql, p)).c;
  const byStatus = Object.fromEntries((await db.all(
    'SELECT status, COUNT(*) c FROM appointments WHERE date = ? GROUP BY status', [today])).map(r => [r.status, r.c]));
  const flow = ['Booked', 'Waiting', 'In consultation', 'Completed', 'No-show'].map(s => ({ status: s, count: byStatus[s] || 0 }));
  const pending = await db.get("SELECT COUNT(*) c, COALESCE(SUM(total), 0) amt FROM bills WHERE status = 'Pending'");

  const stats = {
    appointments_today: Object.entries(byStatus).filter(([s]) => s !== 'Cancelled').reduce((a, [, v]) => a + v, 0),
    patients_waiting: byStatus['Waiting'] || 0,
    in_consultation: byStatus['In consultation'] || 0,
    completed_today: byStatus['Completed'] || 0,
    doctors_total: await c('SELECT COUNT(*) c FROM doctors d JOIN users u ON u.id = d.user_id WHERE u.is_active = 1', []),
    doctors_on_duty: await c("SELECT COUNT(*) c FROM doctors d JOIN users u ON u.id = d.user_id WHERE u.is_active = 1 AND d.status <> 'Not in hospital'", []),
    emergency_cases: await c("SELECT COUNT(*) c FROM appointments WHERE date = ? AND symptom_category = 'emergency' AND status <> 'Cancelled'"),
    revenue_today: Number((await db.get(
      `SELECT COALESCE(SUM(b.total), 0) c FROM bills b JOIN appointments a ON a.id = b.appointment_id
       WHERE a.date = ? AND b.status = 'Paid'`, [today])).c),
    pending_bills: pending.c, pending_amount: Number(pending.amt)
  };

  const serving = Object.fromEntries((await db.all(
    "SELECT doctor_id, token_no FROM appointments WHERE date = ? AND status = 'In consultation'", [today])).map(r => [r.doctor_id, r.token_no]));
  const doctors = await db.all(
    `SELECT d.id, u.name, s.name AS specialty, d.room, d.status, d.avg_consult_time,
            (SELECT COUNT(*) FROM appointments a WHERE a.doctor_id = d.id AND a.date = ? AND a.status = 'Waiting') AS queue_length,
            (SELECT COUNT(*) FROM appointments a WHERE a.doctor_id = d.id AND a.date = ? AND a.status = 'Completed') AS seen_today
     FROM doctors d JOIN users u ON u.id = d.user_id JOIN specialties s ON s.id = d.specialty_id
     WHERE u.is_active = 1 ORDER BY u.name`, [today, today]);
  doctors.forEach(d => { d.now_serving = serving[d.id] || null; });

  // "Needs attention": plain-language alerts so the admin does not have to read tables
  const waiting = await db.all(
    `SELECT a.token_no, a.priority_score, a.arrived_at, a.doctor_id, u.name AS doctor_name, d.status AS doctor_status
     FROM appointments a JOIN doctors d ON d.id = a.doctor_id JOIN users u ON u.id = d.user_id
     WHERE a.date = ? AND a.status = 'Waiting'`, [today]);
  waiting.forEach(w => { w.score = totalScore(w.priority_score, w.arrived_at); w.mins = Math.round((Date.now() - Date.parse(w.arrived_at)) / 60000); });
  const attention = [];
  const emer = waiting.filter(w => w.score >= 100);
  if (emer.length) attention.push({ level: 'red', text: `${emer.length} emergency patient${emer.length > 1 ? 's' : ''} waiting: ${emer.map(e => e.token_no).join(', ')}` });
  const longest = waiting.slice().sort((a, b) => b.mins - a.mins)[0];
  if (longest && longest.mins >= 45) attention.push({ level: 'amber', text: `Longest wait is ${longest.mins} min (token ${longest.token_no}, ${longest.doctor_name})` });
  const idle = {};
  waiting.filter(w => w.doctor_status !== 'In OPD').forEach(w => { (idle[w.doctor_id] = idle[w.doctor_id] || { name: w.doctor_name, status: w.doctor_status, n: 0 }).n++; });
  Object.values(idle).forEach(d => attention.push({ level: 'amber', text: `${d.name} is "${d.status.toLowerCase()}" with ${d.n} patient${d.n > 1 ? 's' : ''} waiting` }));
  if (pending.c) attention.push({ level: 'blue', text: `${pending.c} unpaid bill${pending.c > 1 ? 's' : ''} worth Rs. ${Math.round(Number(pending.amt)).toLocaleString('en-IN')}` });
  if (byStatus['No-show']) attention.push({ level: 'blue', text: `${byStatus['No-show']} patient${byStatus['No-show'] > 1 ? 's' : ''} missed their turn today` });
  if (!attention.length) attention.push({ level: 'green', text: 'Everything looks normal right now' });

  const recent = await db.all(
    `SELECT a.id, a.date, a.token_no, a.status, a.symptom_category, a.source, pu.name AS patient_name, du.name AS doctor_name
     FROM appointments a JOIN patients p ON p.id = a.patient_id JOIN users pu ON pu.id = p.user_id
     JOIN doctors d ON d.id = a.doctor_id JOIN users du ON du.id = d.user_id
     ORDER BY a.id DESC LIMIT 8`);
  res.json({ stats, flow, attention, doctors, recent });
}));

// Analytics for the last 7 / 30 / 90 days, always compared with the same-length period before it
router.get('/analytics', h(async (req, res) => {
  const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 7;
  const ago = n => localDate(addDays(new Date(), -n));
  const to = ago(0), from = ago(days - 1), prevTo = ago(days), prevFrom = ago(2 * days - 1);
  const avg = a => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);

  async function period(a, b) {
    const counts = await db.all('SELECT status, source, COUNT(*) c FROM appointments WHERE date BETWEEN ? AND ? GROUP BY status, source', [a, b]);
    let booked = 0, completed = 0, noShow = 0, cancelled = 0, walkIn = 0;
    counts.forEach(r => {
      if (r.status !== 'Cancelled') { booked += r.c; if (r.source === 'walk-in') walkIn += r.c; }
      if (r.status === 'Completed') completed += r.c;
      if (r.status === 'No-show') noShow += r.c;
      if (r.status === 'Cancelled') cancelled += r.c;
    });
    const revenue = Number((await db.get(
      `SELECT COALESCE(SUM(b.total), 0) v FROM bills b JOIN appointments a ON a.id = b.appointment_id
       WHERE b.status = 'Paid' AND a.date BETWEEN ? AND ?`, [a, b])).v);
    const times = await db.all('SELECT arrived_at, called_at FROM appointments WHERE date BETWEEN ? AND ? AND arrived_at IS NOT NULL AND called_at IS NOT NULL', [a, b]);
    const rating = await db.get('SELECT ROUND(AVG(f.rating), 1) v, COUNT(*) n FROM feedback f JOIN appointments a ON a.id = f.appointment_id WHERE a.date BETWEEN ? AND ?', [a, b]);
    const closed = completed + noShow + cancelled;
    return {
      appointments: booked, completed, no_show: noShow, cancelled, walk_in: walkIn, revenue,
      avg_wait: avg(times.map(t => (Date.parse(t.called_at) - Date.parse(t.arrived_at)) / 60000).filter(x => x >= 0)),
      rating: rating.v, rating_count: rating.n,
      completion_rate: closed ? Math.round(completed / closed * 100) : null,
      no_show_rate: closed ? Math.round(noShow / closed * 100) : null
    };
  }
  const current = await period(from, to), previous = await period(prevFrom, prevTo);

  // one row per day
  const dayList = [];
  for (let i = days - 1; i >= 0; i--) dayList.push(ago(i));
  const perDay = {};
  dayList.forEach(d => { perDay[d] = { date: d, booked: 0, completed: 0, revenue: 0 }; });
  (await db.all('SELECT date, status, COUNT(*) c FROM appointments WHERE date BETWEEN ? AND ? GROUP BY date, status', [from, to])).forEach(r => {
    if (!perDay[r.date]) return;
    if (r.status !== 'Cancelled') perDay[r.date].booked += r.c;
    if (r.status === 'Completed') perDay[r.date].completed += r.c;
  });
  (await db.all(
    `SELECT a.date, SUM(b.total) v FROM bills b JOIN appointments a ON a.id = b.appointment_id
     WHERE b.status = 'Paid' AND a.date BETWEEN ? AND ? GROUP BY a.date`, [from, to])).forEach(r => { if (perDay[r.date]) perDay[r.date].revenue = Number(r.v); });

  const by_status = await db.all('SELECT status AS name, COUNT(*) v FROM appointments WHERE date BETWEEN ? AND ? GROUP BY status', [from, to]);
  const by_priority = await db.all("SELECT symptom_category AS name, COUNT(*) v FROM appointments WHERE date BETWEEN ? AND ? AND status <> 'Cancelled' GROUP BY symptom_category", [from, to]);
  const by_specialty = await db.all(
    `SELECT s.name, COUNT(*) v FROM appointments a JOIN doctors d ON d.id = a.doctor_id JOIN specialties s ON s.id = d.specialty_id
     WHERE a.date BETWEEN ? AND ? AND a.status <> 'Cancelled' GROUP BY s.name ORDER BY v DESC`, [from, to]);
  const payment_methods = (await db.all(
    `SELECT b.payment_method AS name, SUM(b.total) v FROM bills b JOIN appointments a ON a.id = b.appointment_id
     WHERE b.status = 'Paid' AND a.date BETWEEN ? AND ? GROUP BY b.payment_method`, [from, to])).map(r => ({ name: r.name || 'Other', v: Number(r.v) }));
  const top_doctors = await db.all(
    `SELECT u.name, COUNT(*) v,
            (SELECT ROUND(AVG(f.rating), 1) FROM feedback f JOIN appointments a2 ON a2.id = f.appointment_id WHERE a2.doctor_id = d.id) AS rating
     FROM appointments a JOIN doctors d ON d.id = a.doctor_id JOIN users u ON u.id = d.user_id
     WHERE a.status = 'Completed' AND a.date BETWEEN ? AND ? GROUP BY d.id, u.name ORDER BY v DESC LIMIT 6`, [from, to]);

  // busiest hours (check-ins) and average wait per doctor
  const hours = Array.from({ length: 16 }, (_, i) => ({ hour: i + 6, value: 0 }));
  (await db.all('SELECT arrived_at FROM appointments WHERE date BETWEEN ? AND ? AND arrived_at IS NOT NULL', [from, to])).forEach(t => {
    const h = new Date(t.arrived_at).getHours();
    if (h >= 6 && h <= 21) hours[h - 6].value++;
  });
  const waitMap = {};
  (await db.all(
    `SELECT u.name, a.arrived_at, a.called_at FROM appointments a JOIN doctors d ON d.id = a.doctor_id JOIN users u ON u.id = d.user_id
     WHERE a.date BETWEEN ? AND ? AND a.arrived_at IS NOT NULL AND a.called_at IS NOT NULL`, [from, to])).forEach(t => {
    const m = (Date.parse(t.called_at) - Date.parse(t.arrived_at)) / 60000;
    if (m >= 0) (waitMap[t.name] = waitMap[t.name] || []).push(m);
  });
  const wait_by_doctor = Object.entries(waitMap).map(([name, a]) => ({ name, v: avg(a) })).sort((x, y) => y.v - x.v).slice(0, 8);

  res.json({ days, from, to, current, previous, daily: dayList.map(d => perDay[d]), by_status, by_priority, by_specialty,
             payment_methods, top_doctors, peak_hours: hours, wait_by_doctor });
}));

/* ---------- Doctors & specialties ---------- */
router.get('/doctors', h(async (req, res) => {
  const docs = await db.all(
    `SELECT d.id, d.user_id, u.name, u.email, u.phone, u.is_active, d.specialty_id, s.name AS specialty, d.room, d.status,
            d.avg_consult_time, d.experience, d.consultation_fee, d.max_daily_patients, d.qualification
     FROM doctors d JOIN users u ON u.id = d.user_id JOIN specialties s ON s.id = d.specialty_id ORDER BY u.name`);
  const sched = await getAllSchedules();
  docs.forEach(d => { d.schedule = sched[d.id] || []; });
  res.json({ doctors: docs, specialties: await db.all('SELECT id, name FROM specialties ORDER BY name') });
}));

function doctorFields(b) {
  const room = str(b.room, 20);
  const avg = Number(b.avg_consult_time ?? 10), exp = Number(b.experience ?? 0);
  const fee = Number(b.consultation_fee ?? 500), max = Number(b.max_daily_patients ?? 40);
  if (!room) throw httpError(400, 'Enter the room number');
  if (!Number.isInteger(avg) || avg < 1 || avg > 120) throw httpError(400, 'Average consult time must be 1-120 minutes');
  if (!Number.isInteger(exp) || exp < 0 || exp > 70) throw httpError(400, 'Enter valid experience in years');
  if (!Number.isFinite(fee) || fee < 0 || fee > 100000) throw httpError(400, 'Enter a valid consultation fee');
  if (!Number.isInteger(max) || max < 1 || max > 500) throw httpError(400, 'Daily patient limit must be 1-500');
  return { room, avg, exp, fee, max, qualification: str(b.qualification, 120) || null };
}

router.post('/doctors', h(async (req, res) => {
  const b = req.body || {};
  const name = str(b.name, 80), email = str(b.email, 120).toLowerCase();
  const specialtyId = Number(b.specialty_id);
  if (name.length < 2) throw httpError(400, 'Enter the doctor name');
  if (!EMAIL_RE.test(email)) throw httpError(400, 'Enter a valid email');
  if (!strongPassword(b.password)) throw httpError(400, 'Password must be at least 8 characters and contain a letter and a number');
  if (str(b.phone, 20) && !PHONE_RE.test(str(b.phone, 20))) throw httpError(400, 'Enter a valid phone number');
  if (!(await db.get('SELECT id FROM specialties WHERE id = ?', [specialtyId]))) throw httpError(400, 'Choose a specialty');
  if (await db.get('SELECT id FROM users WHERE email = ?', [email])) throw httpError(409, 'This email is already registered');
  const f = doctorFields(b);
  const hash = await bcrypt.hash(b.password, 10);
  await db.tx(async t => {
    const u = await t.run('INSERT INTO users (name,email,phone,password,role,created_at) VALUES (?,?,?,?,?,?)',
      [name, email, str(b.phone, 20) || null, hash, 'doctor', now()]);
    await t.run(
      `INSERT INTO doctors (user_id,specialty_id,room,avg_consult_time,experience,consultation_fee,max_daily_patients,qualification)
       VALUES (?,?,?,?,?,?,?,?)`, [u.insertId, specialtyId, f.room, f.avg, f.exp, f.fee, f.max, f.qualification]);
  });
  await audit(req, 'DOCTOR_ADDED', name);
  broadcast();
  res.status(201).json({ ok: true });
}));

router.put('/doctors/:id', h(async (req, res) => {
  const d = await db.get('SELECT * FROM doctors WHERE id = ?', [Number(req.params.id)]);
  if (!d) throw httpError(404, 'Doctor not found');
  const b = req.body || {};
  const specialtyId = b.specialty_id !== undefined ? Number(b.specialty_id) : d.specialty_id;
  if (!(await db.get('SELECT id FROM specialties WHERE id = ?', [specialtyId]))) throw httpError(400, 'Choose a specialty');
  const f = doctorFields({ room: d.room, avg_consult_time: d.avg_consult_time, experience: d.experience,
    consultation_fee: d.consultation_fee, max_daily_patients: d.max_daily_patients, qualification: d.qualification, ...b });
  await db.tx(async t => {
    await t.run(
      `UPDATE doctors SET specialty_id=?, room=?, avg_consult_time=?, experience=?, consultation_fee=?, max_daily_patients=?, qualification=? WHERE id=?`,
      [specialtyId, f.room, f.avg, f.exp, f.fee, f.max, f.qualification, d.id]);
    if (b.is_active !== undefined) await t.run('UPDATE users SET is_active = ? WHERE id = ?', [b.is_active ? 1 : 0, d.user_id]);
  });
  invalidateUser(d.user_id);
  await audit(req, 'DOCTOR_UPDATED', `doctor ${d.id}`);
  broadcast();
  res.json({ ok: true });
}));

router.put('/doctors/:id/schedule', h(async (req, res) => {
  const d = await db.get('SELECT id FROM doctors WHERE id = ?', [Number(req.params.id)]);
  if (!d) throw httpError(404, 'Doctor not found');
  await saveSchedule(d.id, (req.body || {}).days);
  await audit(req, 'SCHEDULE_UPDATED', `doctor ${d.id}`);
  res.json({ ok: true });
}));

router.post('/specialties', h(async (req, res) => {
  const name = str((req.body || {}).name, 50);
  if (name.length < 2) throw httpError(400, 'Enter a specialty name');
  if (await db.get('SELECT id FROM specialties WHERE LOWER(name) = LOWER(?)', [name])) throw httpError(409, 'This specialty already exists');
  await db.run('INSERT INTO specialties (name) VALUES (?)', [name]);
  res.status(201).json({ ok: true });
}));

router.delete('/specialties/:id', h(async (req, res) => {
  const id = Number(req.params.id);
  if (await db.get('SELECT id FROM doctors WHERE specialty_id = ? LIMIT 1', [id])) throw httpError(400, 'Doctors still use this specialty');
  await db.run('DELETE FROM specialties WHERE id = ?', [id]);
  res.json({ ok: true });
}));

/* ---------- Users ---------- */
router.get('/users', h(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1), size = 20;
  const q = str(req.query.q, 60).replace(/[%_]/g, '');
  const roleF = ['patient', 'doctor', 'admin', 'receptionist'].includes(req.query.role) ? req.query.role : null;
  const like = `%${q}%`;
  const where = '(? IS NULL OR role = ?) AND (name LIKE ? OR email LIKE ? OR phone LIKE ?)';
  const params = [roleF, roleF, like, like, like];
  const total = (await db.get(`SELECT COUNT(*) c FROM users WHERE ${where}`, params)).c;
  const rows = await db.all(
    `SELECT id, name, email, phone, role, is_active, created_at, last_login FROM users WHERE ${where}
     ORDER BY id DESC LIMIT ? OFFSET ?`, [...params, size, (page - 1) * size]);
  res.json({ users: rows, total, page, pages: Math.max(1, Math.ceil(total / size)) });
}));

router.post('/users', h(async (req, res) => {
  const b = req.body || {};
  const name = str(b.name, 80), email = str(b.email, 120).toLowerCase();
  if (!['receptionist', 'admin'].includes(b.role)) throw httpError(400, 'Staff role must be receptionist or admin');
  if (name.length < 2) throw httpError(400, 'Enter the name');
  if (!EMAIL_RE.test(email)) throw httpError(400, 'Enter a valid email');
  if (!strongPassword(b.password)) throw httpError(400, 'Password must be at least 8 characters and contain a letter and a number');
  if (await db.get('SELECT id FROM users WHERE email = ?', [email])) throw httpError(409, 'This email is already registered');
  await db.run('INSERT INTO users (name,email,phone,password,role,created_at) VALUES (?,?,?,?,?,?)',
    [name, email, str(b.phone, 20) || null, await bcrypt.hash(b.password, 10), b.role, now()]);
  await audit(req, 'STAFF_ADDED', `${b.role} ${email}`);
  res.status(201).json({ ok: true });
}));

router.put('/users/:id/active', h(async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) throw httpError(400, 'You cannot disable your own account');
  const r = await db.run('UPDATE users SET is_active = ? WHERE id = ?', [(req.body || {}).active ? 1 : 0, id]);
  if (!r.affectedRows) throw httpError(404, 'User not found');
  invalidateUser(id);
  await audit(req, (req.body || {}).active ? 'USER_ENABLED' : 'USER_DISABLED', `user ${id}`);
  broadcast();
  res.json({ ok: true });
}));

router.post('/users/:id/reset-password', h(async (req, res) => {
  const u = await db.get('SELECT id, email FROM users WHERE id = ?', [Number(req.params.id)]);
  if (!u) throw httpError(404, 'User not found');
  const temp = 'Mq' + crypto.randomBytes(4).toString('hex') + '7';
  await db.run('UPDATE users SET password = ? WHERE id = ?', [await bcrypt.hash(temp, 10), u.id]);
  await audit(req, 'PASSWORD_RESET', u.email);
  res.json({ temp_password: temp });
}));

/* ---------- Billing, announcements, audit, export ---------- */
router.get('/bills', h(async (req, res) => {
  const status = ['Pending', 'Paid', 'Waived'].includes(req.query.status) ? req.query.status : null;
  res.json(await db.all(
    `SELECT b.id, b.total, b.status, b.payment_method, b.paid_at, a.token_no, a.date,
            pu.name AS patient_name, du.name AS doctor_name
     FROM bills b JOIN appointments a ON a.id = b.appointment_id
     JOIN patients p ON p.id = a.patient_id JOIN users pu ON pu.id = p.user_id
     JOIN doctors d ON d.id = a.doctor_id JOIN users du ON du.id = d.user_id
     WHERE (? IS NULL OR b.status = ?) ORDER BY b.id DESC LIMIT 200`, [status, status]));
}));

router.put('/bills/:id/waive', h(async (req, res) => {
  const r = await db.run("UPDATE bills SET status = 'Waived', discount = amount + extra_charges, total = 0 WHERE id = ? AND status = 'Pending'", [Number(req.params.id)]);
  if (!r.affectedRows) throw httpError(400, 'Only a pending bill can be waived');
  await audit(req, 'BILL_WAIVED', `bill ${req.params.id}`);
  res.json({ ok: true });
}));

router.post('/announcements', h(async (req, res) => {
  const message = str((req.body || {}).message, 280);
  const audience = (req.body || {}).audience;
  if (message.length < 3) throw httpError(400, 'Write the announcement');
  const roles = { patients: ['patient'], doctors: ['doctor'], staff: ['doctor', 'receptionist', 'admin'], all: ['patient', 'doctor', 'receptionist', 'admin'] }[audience];
  if (!roles) throw httpError(400, 'Choose who should receive it');
  for (const r of roles) {
    await db.run("INSERT INTO notifications (user_id, message, created_at) SELECT id, ?, ? FROM users WHERE role = ? AND is_active = 1 AND email NOT LIKE '%@walkin.local'",
      ['Announcement: ' + message, now(), r]);
  }
  announce(roles, 'Announcement: ' + message);
  await audit(req, 'ANNOUNCEMENT', `${audience}: ${message}`.slice(0, 200));
  res.status(201).json({ ok: true });
}));

router.get('/audit', h(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1), size = 25;
  const total = (await db.get('SELECT COUNT(*) c FROM audit_logs')).c;
  const rows = await db.all(
    `SELECT l.id, l.action, l.details, l.ip, l.created_at, u.name AS user_name, u.role AS user_role
     FROM audit_logs l LEFT JOIN users u ON u.id = l.user_id ORDER BY l.id DESC LIMIT ? OFFSET ?`, [size, (page - 1) * size]);
  res.json({ logs: rows, total, page, pages: Math.max(1, Math.ceil(total / size)) });
}));

const EXPORTS = {
  appointments: {
    cols: ['id', 'date', 'token_no', 'status', 'source', 'symptom_category', 'patient', 'doctor', 'specialty', 'arrived_at', 'called_at', 'completed_at'],
    sql: `SELECT a.id, a.date, a.token_no, a.status, a.source, a.symptom_category, pu.name AS patient, du.name AS doctor,
                 s.name AS specialty, a.arrived_at, a.called_at, a.completed_at
          FROM appointments a JOIN patients p ON p.id = a.patient_id JOIN users pu ON pu.id = p.user_id
          JOIN doctors d ON d.id = a.doctor_id JOIN users du ON du.id = d.user_id JOIN specialties s ON s.id = d.specialty_id
          ORDER BY a.id DESC LIMIT 20000`
  },
  bills: {
    cols: ['id', 'date', 'token_no', 'patient', 'doctor', 'amount', 'extra_charges', 'discount', 'total', 'status', 'payment_method', 'paid_at'],
    sql: `SELECT b.id, a.date, a.token_no, pu.name AS patient, du.name AS doctor, b.amount, b.extra_charges, b.discount,
                 b.total, b.status, b.payment_method, b.paid_at
          FROM bills b JOIN appointments a ON a.id = b.appointment_id JOIN patients p ON p.id = a.patient_id
          JOIN users pu ON pu.id = p.user_id JOIN doctors d ON d.id = a.doctor_id JOIN users du ON du.id = d.user_id
          ORDER BY b.id DESC LIMIT 20000`
  },
  patients: {
    cols: ['id', 'name', 'email', 'phone', 'dob', 'gender', 'blood_group', 'chronic'],
    sql: `SELECT p.id, u.name, u.email, u.phone, p.dob, p.gender, p.blood_group, p.chronic_flag AS chronic
          FROM patients p JOIN users u ON u.id = p.user_id ORDER BY p.id LIMIT 20000`
  }
};
router.get('/export/:type', h(async (req, res) => {
  const ex = EXPORTS[req.params.type];
  if (!ex) throw httpError(404, 'Unknown export');
  const rows = await db.all(ex.sql);
  await audit(req, 'EXPORT', req.params.type);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.type}-${localDate()}.csv"`);
  res.send(toCsv(rows, ex.cols));
}));

module.exports = router;
