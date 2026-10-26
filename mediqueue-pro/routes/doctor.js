const router = require('express').Router();
const db = require('../db');
const { auth, role } = require('../middleware/auth');
const { h, httpError, localDate, addDays, now, DOCTOR_STATUSES, str, optNum, validDate } = require('../utils/helpers');
const { APPT_PATIENT_SQL, decorate, getQueue } = require('../utils/queue');
const { completedVisits } = require('../utils/history');
const { getSchedule, saveSchedule } = require('../utils/schedule');
const { broadcast, notify } = require('../realtime');
const { audit } = require('../utils/audit');

router.use(auth, role('doctor'));

async function me(req) {
  const d = await db.get(
    `SELECT d.*, u.name, s.name AS specialty
     FROM doctors d JOIN users u ON u.id = d.user_id JOIN specialties s ON s.id = d.specialty_id
     WHERE d.user_id = ?`, [req.user.id]);
  if (!d) throw httpError(404, 'Doctor profile not found');
  return d;
}
const dr = name => (/^dr\.?\s/i.test(name) ? name : 'Dr. ' + name);
const strip = r => { delete r.qr_code; return r; };

router.put('/status', h(async (req, res) => {
  const d = await me(req);
  const status = String((req.body || {}).status || '');
  if (!DOCTOR_STATUSES.includes(status)) throw httpError(400, 'Invalid status');
  await db.run('UPDATE doctors SET status = ? WHERE id = ?', [status, d.id]);
  broadcast();
  res.json({ status });
}));

router.get('/dashboard', h(async (req, res) => {
  const d = await me(req);
  const today = localDate();
  const queue = (await getQueue(d.id, today)).map(strip);
  const current = await db.get(
    `${APPT_PATIENT_SQL} WHERE a.doctor_id = ? AND a.status = 'In consultation' ORDER BY a.called_at LIMIT 1`, [d.id]);
  if (current) strip(decorate(current));

  const done = await db.all(
    "SELECT called_at, completed_at FROM appointments WHERE doctor_id = ? AND date = ? AND status = 'Completed'", [d.id, today]);
  const mins = done.filter(x => x.called_at && x.completed_at)
    .map(x => (Date.parse(x.completed_at) - Date.parse(x.called_at)) / 60000);
  const avgActual = mins.length ? Math.round(mins.reduce((a, b) => a + b, 0) / mins.length * 10) / 10 : null;
  const missed = (await db.get("SELECT COUNT(*) c FROM appointments WHERE doctor_id = ? AND date = ? AND status = 'No-show'", [d.id, today])).c;

  // last 7 days: patients seen per day
  const since = localDate(addDays(new Date(), -6));
  const rows = await db.all(
    "SELECT date, COUNT(*) c FROM appointments WHERE doctor_id = ? AND status = 'Completed' AND date >= ? GROUP BY date", [d.id, since]);
  const byDay = Object.fromEntries(rows.map(r => [r.date, r.c]));
  const week = [];
  for (let i = 6; i >= 0; i--) { const day = localDate(addDays(new Date(), -i)); week.push({ date: day, seen: byDay[day] || 0 }); }

  res.json({
    doctor: { id: d.id, name: d.name, specialty: d.specialty, room: d.room, status: d.status,
              avg_consult_time: d.avg_consult_time, consultation_fee: d.consultation_fee },
    stats: { waiting: queue.length, seen: done.length, missed, avg_actual: avgActual },
    current: current || null, queue, week
  });
}));

router.post('/call-next', h(async (req, res) => {
  const d = await me(req);
  if (d.status !== 'In OPD') throw httpError(400, 'Set your status to "In OPD" before calling patients');
  if (await db.get("SELECT id FROM appointments WHERE doctor_id = ? AND status = 'In consultation'", [d.id])) {
    throw httpError(400, 'Complete the current visit before calling the next patient');
  }
  const queue = await getQueue(d.id, localDate());
  if (!queue.length) throw httpError(400, 'The queue is empty');

  const next = queue[0];
  const r = await db.run("UPDATE appointments SET status = 'In consultation', called_at = ? WHERE id = ? AND status = 'Waiting'", [now(), next.id]);
  if (!r.affectedRows) throw httpError(409, 'That patient is no longer waiting. Please try again');
  await notify(next.patient_user_id, `Please go to Room ${d.room}. ${dr(d.name)} is ready for you (token ${next.token_no}).`);
  const after = await getQueue(d.id, localDate());
  if (after.length) await notify(after[0].patient_user_id, `You are next in line for ${dr(d.name)}. Please wait near Room ${d.room}.`);
  broadcast();
  res.json({ called: next.token_no });
}));

// Called patient is not there: mark as missed (reception can put them back in the queue)
router.post('/skip', h(async (req, res) => {
  const d = await me(req);
  const a = await db.get(`${APPT_PATIENT_SQL} WHERE a.doctor_id = ? AND a.status = 'In consultation' LIMIT 1`, [d.id]);
  if (!a) throw httpError(404, 'No patient is being consulted');
  await db.run("UPDATE appointments SET status = 'No-show' WHERE id = ?", [a.id]);
  await notify(a.patient_user_id, `You missed your turn (token ${a.token_no}). Please meet the reception desk to rejoin the queue.`);
  await audit(req, 'PATIENT_SKIPPED', a.token_no);
  broadcast();
  res.json({ ok: true });
}));

router.post('/complete', h(async (req, res) => {
  const d = await me(req);
  const b = req.body || {};
  const a = await db.get("SELECT * FROM appointments WHERE id = ? AND doctor_id = ? AND status = 'In consultation'",
    [Number(b.appointment_id), d.id]);
  if (!a) throw httpError(404, 'No active consultation found');

  const diagnosis = str(b.diagnosis, 255), notes = str(b.notes, 2000), medicines = str(b.medicines, 2000);
  const tests = str(b.tests_advised, 500), bp = str(b.bp, 10);
  if (!diagnosis && !notes && !medicines) throw httpError(400, 'Add a diagnosis, notes or at least one medicine');
  if (bp && !/^\d{2,3}\/\d{2,3}$/.test(bp)) throw httpError(400, 'Blood pressure should look like 120/80');
  let follow = null;
  if (b.follow_up_date) {
    if (!validDate(b.follow_up_date) || b.follow_up_date < localDate()) throw httpError(400, 'Follow-up date must be today or later');
    follow = b.follow_up_date;
  }
  const temperature = optNum(b.temperature, 30, 45, 'Temperature');
  const pulse = optNum(b.pulse, 30, 250, 'Pulse');
  const weight = optNum(b.weight, 1, 400, 'Weight');
  const extra = optNum(b.extra_charges, 0, 100000, 'Extra charges') || 0;

  await db.tx(async t => {
    const ts = now();
    await t.run(
      `INSERT INTO prescriptions (appointment_id, diagnosis, notes, medicines, tests_advised, follow_up_date,
         bp, temperature, pulse, weight, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [a.id, diagnosis || null, notes || null, medicines || null, tests || null, follow, bp || null, temperature, pulse, weight, ts]);
    await t.run("UPDATE appointments SET status = 'Completed', completed_at = ? WHERE id = ?", [ts, a.id]);
    await t.run('INSERT INTO bills (appointment_id, amount, extra_charges, discount, total, status, created_at) VALUES (?,?,?,?,?,?,?)',
      [a.id, d.consultation_fee, extra, 0, Number(d.consultation_fee) + extra, 'Pending', ts]);
  });
  const p = await db.get('SELECT user_id FROM patients WHERE id = ?', [a.patient_id]);
  await notify(p.user_id, `Your visit is complete. Your prescription from ${dr(d.name)} is in your history. Please pay the bill at the reception.`);
  broadcast();
  res.json({ ok: true });
}));

// Past visits of a patient, only for patients who have an appointment with this doctor
router.get('/history/:patientId', h(async (req, res) => {
  const d = await me(req);
  const pid = Number(req.params.patientId);
  if (!(await db.get('SELECT id FROM appointments WHERE patient_id = ? AND doctor_id = ? LIMIT 1', [pid, d.id]))) {
    throw httpError(403, 'This patient is not in your appointments');
  }
  res.json(await completedVisits(pid));
}));

router.get('/schedule', h(async (req, res) => res.json(await getSchedule((await me(req)).id))));
router.put('/schedule', h(async (req, res) => {
  const d = await me(req);
  await saveSchedule(d.id, (req.body || {}).days);
  await audit(req, 'SCHEDULE_UPDATED', d.name);
  res.json({ ok: true });
}));

module.exports = router;
