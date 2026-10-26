const router = require('express').Router();
const QRCode = require('qrcode');
const db = require('../db');
const { BASE_URL } = require('../config');
const { auth, role } = require('../middleware/auth');
const { h, httpError, localDate, str, validDob, EMAIL_RE, PHONE_RE, ageFromDob } = require('../utils/helpers');
const { createAppointment, checkIn, trackInfo, expireOldAppointments } = require('../utils/queue');
const { allVisits } = require('../utils/history');
const { broadcast } = require('../realtime');

router.use(auth, role('patient'));

async function me(req) {
  const p = await db.get('SELECT * FROM patients WHERE user_id = ?', [req.user.id]);
  if (!p) throw httpError(404, 'Patient profile not found');
  return p;
}
// A patient can only ever touch their own appointments
async function owned(req) {
  const p = await me(req);
  const a = await db.get('SELECT * FROM appointments WHERE id = ? AND patient_id = ?', [Number(req.params.id), p.id]);
  if (!a) throw httpError(404, 'Appointment not found');
  return a;
}
const BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

router.get('/profile', h(async (req, res) => {
  const p = await me(req);
  const u = await db.get('SELECT name, email, phone FROM users WHERE id = ?', [req.user.id]);
  res.json({ ...u, dob: p.dob, age: ageFromDob(p.dob), gender: p.gender, blood_group: p.blood_group,
             medical_history: p.medical_history, allergies: p.allergies, chronic: !!p.chronic_flag,
             address: p.address, emergency_contact: p.emergency_contact });
}));

router.put('/profile', h(async (req, res) => {
  const p = await me(req);
  const b = req.body || {};
  const name = str(b.name, 80), phone = str(b.phone, 20);
  if (name.length < 2) throw httpError(400, 'Enter your full name');
  if (phone && !PHONE_RE.test(phone)) throw httpError(400, 'Enter a valid phone number');
  if (!validDob(b.dob)) throw httpError(400, 'Enter a valid date of birth');
  await db.tx(async t => {
    await t.run('UPDATE users SET name = ?, phone = ? WHERE id = ?', [name, phone || null, req.user.id]);
    await t.run(
      `UPDATE patients SET dob = ?, gender = ?, blood_group = ?, medical_history = ?, allergies = ?,
         chronic_flag = ?, address = ?, emergency_contact = ? WHERE id = ?`,
      [b.dob, ['Male', 'Female', 'Other'].includes(b.gender) ? b.gender : null, BLOOD.includes(b.blood_group) ? b.blood_group : null,
       str(b.medical_history, 500) || null, str(b.allergies, 200) || null, b.chronic ? 1 : 0,
       str(b.address, 200) || null, str(b.emergency_contact, 100) || null, p.id]);
  });
  res.json({ ok: true });
}));

router.post('/appointments', h(async (req, res) => {
  await expireOldAppointments();
  const p = await me(req);
  const b = req.body || {};
  const id = await createAppointment({
    patientId: p.id, doctorId: Number(b.doctor_id), date: String(b.date || localDate()),
    category: b.symptom_category, symptoms: b.symptoms
  });
  broadcast();
  res.status(201).json(await trackInfo(await db.get('SELECT * FROM appointments WHERE id = ?', [id])));
}));

router.get('/appointments', h(async (req, res) => {
  const p = await me(req);
  const rows = await db.all(
    `SELECT * FROM appointments WHERE patient_id = ? AND status IN ('Booked','Waiting','In consultation')
     ORDER BY date, id`, [p.id]);
  res.json(await Promise.all(rows.map(trackInfo)));
}));

router.post('/appointments/:id/cancel', h(async (req, res) => {
  const a = await owned(req);
  if (!['Booked', 'Waiting'].includes(a.status)) throw httpError(400, 'Only booked or waiting appointments can be cancelled');
  await db.run("UPDATE appointments SET status = 'Cancelled' WHERE id = ?", [a.id]);
  broadcast();
  res.json({ ok: true });
}));

router.post('/appointments/:id/checkin', h(async (req, res) => {
  const a = await owned(req);
  await checkIn(a.id);
  broadcast();
  res.json(await trackInfo(await db.get('SELECT * FROM appointments WHERE id = ?', [a.id])));
}));

router.get('/appointments/:id/qr', h(async (req, res) => {
  const a = await owned(req);
  const base = BASE_URL || `${req.protocol}://${req.get('host')}`;
  const url = `${base}/checkin.html?code=${a.qr_code}`;
  res.json({ url, dataUrl: await QRCode.toDataURL(url, { width: 220, margin: 1 }) });
}));

router.get('/history', h(async (req, res) => res.json(await allVisits((await me(req)).id))));

router.get('/bills', h(async (req, res) => {
  const p = await me(req);
  res.json(await db.all(
    `SELECT b.id, b.amount, b.extra_charges, b.discount, b.total, b.status, b.payment_method, b.paid_at,
            b.created_at, a.date, a.token_no, u.name AS doctor_name, s.name AS specialty
     FROM bills b JOIN appointments a ON a.id = b.appointment_id
     JOIN doctors d ON d.id = a.doctor_id JOIN users u ON u.id = d.user_id
     JOIN specialties s ON s.id = d.specialty_id
     WHERE a.patient_id = ? ORDER BY b.id DESC`, [p.id]));
}));

router.post('/appointments/:id/feedback', h(async (req, res) => {
  const a = await owned(req);
  if (a.status !== 'Completed') throw httpError(400, 'You can rate a visit after it is completed');
  const rating = Number((req.body || {}).rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw httpError(400, 'Choose a rating from 1 to 5');
  if (await db.get('SELECT id FROM feedback WHERE appointment_id = ?', [a.id])) throw httpError(409, 'You have already rated this visit');
  await db.run('INSERT INTO feedback (appointment_id, rating, comment, created_at) VALUES (?,?,?,?)',
    [a.id, rating, str((req.body || {}).comment, 300) || null, new Date()]);
  res.status(201).json({ ok: true });
}));

module.exports = router;
