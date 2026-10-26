const router = require('express').Router();
const db = require('../db');
const { HOSPITAL_NAME } = require('../config');
const { auth, role } = require('../middleware/auth');
const { h, httpError, localDate } = require('../utils/helpers');
const { checkIn, trackInfo, getQueue } = require('../utils/queue');
const { getAllSchedules } = require('../utils/schedule');
const { broadcast } = require('../realtime');

router.get('/public/info', h(async (req, res) => res.json({ hospital: HOSPITAL_NAME })));

// Waiting-room display board: token numbers only, no patient names
let boardCache = { at: 0, data: null };
router.get('/public/display', h(async (req, res) => {
  if (!boardCache.data || Date.now() - boardCache.at > 3000) {
    const today = localDate();
    const docs = await db.all(
      `SELECT d.id, u.name, s.name AS specialty, d.room, d.status
       FROM doctors d JOIN users u ON u.id = d.user_id JOIN specialties s ON s.id = d.specialty_id
       WHERE u.is_active = 1 ORDER BY d.room`);
    const out = [];
    for (const d of docs) {
      const serving = await db.get(
        "SELECT token_no FROM appointments WHERE doctor_id = ? AND date = ? AND status = 'In consultation' ORDER BY called_at DESC LIMIT 1",
        [d.id, today]);
      const q = await getQueue(d.id, today);
      out.push({ name: d.name, specialty: d.specialty, room: d.room, status: d.status,
                 now_serving: serving ? serving.token_no : null, waiting: q.length,
                 next: q.slice(0, 3).map(x => ({ token_no: x.token_no, label: x.label })) });
    }
    boardCache = { at: Date.now(), data: { hospital: HOSPITAL_NAME, doctors: out } };
  }
  res.json(boardCache.data);
}));

// Public QR check-in: the secret code inside the QR identifies the appointment
router.post('/checkin/:code', h(async (req, res) => {
  const a = await db.get('SELECT id, status FROM appointments WHERE qr_code = ?', [String(req.params.code).slice(0, 40)]);
  if (!a) throw httpError(404, 'This QR code is not valid');
  const already = a.status !== 'Booked';
  await checkIn(a.id);
  broadcast();
  const t = await trackInfo(await db.get('SELECT * FROM appointments WHERE id = ?', [a.id]));
  res.json({
    already, status: t.status, token_no: t.token_no, doctor_name: t.doctor_name, room: t.room, label: t.label,
    position: t.position, patients_ahead: t.patients_ahead, estimated_wait: t.estimated_wait
  });
}));

router.get('/specialties', auth, h(async (req, res) => {
  res.json(await db.all('SELECT id, name FROM specialties ORDER BY name'));
}));

// Active doctors with live status, queue length, rating and weekly schedule
router.get('/doctors', auth, h(async (req, res) => {
  const sid = req.query.specialty_id ? Number(req.query.specialty_id) : null;
  const docs = await db.all(
    `SELECT d.id, u.name, s.name AS specialty, d.specialty_id, d.room, d.status, d.avg_consult_time,
            d.experience, d.consultation_fee, d.qualification,
            (SELECT COUNT(*) FROM appointments a
               WHERE a.doctor_id = d.id AND a.date = ? AND a.status = 'Waiting') AS waiting,
            (SELECT ROUND(AVG(f.rating), 1) FROM feedback f JOIN appointments a2 ON a2.id = f.appointment_id
               WHERE a2.doctor_id = d.id) AS rating,
            (SELECT COUNT(*) FROM feedback f2 JOIN appointments a3 ON a3.id = f2.appointment_id
               WHERE a3.doctor_id = d.id) AS rating_count
     FROM doctors d JOIN users u ON u.id = d.user_id JOIN specialties s ON s.id = d.specialty_id
     WHERE u.is_active = 1 AND (? IS NULL OR d.specialty_id = ?)
     ORDER BY u.name`, [localDate(), sid, sid]);
  const sched = await getAllSchedules();
  docs.forEach(d => { d.schedule = sched[d.id] || []; });
  res.json(docs);
}));

router.get('/medicines', auth, role('doctor'), h(async (req, res) => {
  res.json((await db.all('SELECT name FROM medicines ORDER BY name')).map(m => m.name));
}));

router.get('/notifications', auth, h(async (req, res) => {
  const items = await db.all(
    'SELECT id, message, is_read, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 30', [req.user.id]);
  res.json({ items, unread: items.filter(n => !n.is_read).length });
}));

router.post('/notifications/read', auth, h(async (req, res) => {
  await db.run('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [req.user.id]);
  res.json({ ok: true });
}));

module.exports = router;
