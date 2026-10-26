const router = require('express').Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { auth, role } = require('../middleware/auth');
const { h, httpError, localDate, now, str, optNum, PHONE_RE, dobFromAge, ageFromDob, validDate } = require('../utils/helpers');
const { APPT_PATIENT_SQL, decorate, createAppointment, checkIn, requeue, trackInfo } = require('../utils/queue');
const { broadcast, notify } = require('../realtime');
const { audit } = require('../utils/audit');

router.use(auth, role('receptionist', 'admin'));

router.get('/today', h(async (req, res) => {
  const rows = await db.all(
    `SELECT a.id, a.token_no, a.status, a.source, a.priority_score, a.arrived_at, a.symptom_category,
            pu.name AS patient_name, pu.phone AS patient_phone, du.name AS doctor_name, d.room,
            b.id AS bill_id, b.status AS bill_status, b.total AS bill_total
     FROM appointments a
     JOIN patients p ON p.id = a.patient_id JOIN users pu ON pu.id = p.user_id
     JOIN doctors d ON d.id = a.doctor_id JOIN users du ON du.id = d.user_id
     LEFT JOIN bills b ON b.appointment_id = a.id
     WHERE a.date = ? AND a.status <> 'Cancelled' ORDER BY a.doctor_id, a.id`, [localDate()]);
  rows.forEach(r => {
    const waiting = r.status === 'Waiting';
    r.label = decorate({ status: r.status, priority_score: r.priority_score, arrived_at: r.arrived_at }).label;
  });
  res.json(rows);
}));

router.post('/checkin/:id', h(async (req, res) => {
  await checkIn(Number(req.params.id));
  broadcast();
  res.json({ ok: true });
}));

router.post('/requeue/:id', h(async (req, res) => {
  await requeue(Number(req.params.id));
  await audit(req, 'PATIENT_REQUEUED', req.params.id);
  broadcast();
  res.json({ ok: true });
}));

// Walk-in patient: quick patient record, booked for today and checked in at once
router.post('/walkin', h(async (req, res) => {
  const b = req.body || {};
  const name = str(b.name, 80), phone = str(b.phone, 20);
  const age = Number(b.age);
  if (name.length < 2) throw httpError(400, 'Enter the patient name');
  if (!Number.isInteger(age) || age < 0 || age > 120) throw httpError(400, 'Enter a valid age');
  if (phone && !PHONE_RE.test(phone)) throw httpError(400, 'Enter a valid phone number');
  const hash = await bcrypt.hash(crypto.randomBytes(12).toString('hex'), 8);

  const apptId = await db.tx(async t => {
    const email = `walkin-${Date.now()}-${crypto.randomBytes(3).toString('hex')}@walkin.local`;
    const u = await t.run('INSERT INTO users (name,email,phone,password,role,created_at) VALUES (?,?,?,?,?,?)',
      [name, email, phone || null, hash, 'patient', now()]);
    const p = await t.run(
      'INSERT INTO patients (user_id,dob,gender,medical_history,chronic_flag) VALUES (?,?,?,?,?)',
      [u.insertId, dobFromAge(age), ['Male', 'Female', 'Other'].includes(b.gender) ? b.gender : null,
       str(b.medical_history, 500) || null, b.chronic_flag ? 1 : 0]);
    return createAppointment({ patientId: p.insertId, doctorId: Number(b.doctor_id), date: localDate(),
      category: b.symptom_category, symptoms: b.symptoms, source: 'walk-in', checkin: true }, t);
  });
  await audit(req, 'WALKIN_REGISTERED', name);
  broadcast();
  res.status(201).json(await trackInfo(await db.get('SELECT * FROM appointments WHERE id = ?', [apptId])));
}));

// Find an existing patient by name, phone or email
router.get('/patients', h(async (req, res) => {
  const q = str(req.query.q, 60).replace(/[%_]/g, '');
  if (q.length < 2) return res.json([]);
  const like = `%${q}%`;
  const rows = await db.all(
    `SELECT p.id AS patient_id, u.name, u.phone, u.email, p.dob, p.gender, p.chronic_flag
     FROM patients p JOIN users u ON u.id = p.user_id
     WHERE u.name LIKE ? OR u.phone LIKE ? OR u.email LIKE ? ORDER BY u.name LIMIT 20`, [like, like, like]);
  rows.forEach(r => { r.age = ageFromDob(r.dob); delete r.dob; });
  res.json(rows);
}));

// Front desk books for an existing patient (can also check in at once when the date is today)
router.post('/book', h(async (req, res) => {
  const b = req.body || {};
  const date = validDate(b.date) ? b.date : localDate();
  const id = await createAppointment({ patientId: Number(b.patient_id), doctorId: Number(b.doctor_id), date,
    category: b.symptom_category, symptoms: b.symptoms, source: 'walk-in', checkin: !!b.checkin && date === localDate() });
  await audit(req, 'RECEPTION_BOOKING', `appointment ${id}`);
  broadcast();
  res.status(201).json(await trackInfo(await db.get('SELECT * FROM appointments WHERE id = ?', [id])));
}));

router.get('/bills', h(async (req, res) => {
  const status = ['Pending', 'Paid', 'Waived'].includes(req.query.status) ? req.query.status : 'Pending';
  res.json(await db.all(
    `SELECT b.id, b.amount, b.extra_charges, b.discount, b.total, b.status, b.payment_method, b.paid_at,
            a.token_no, a.date, pu.name AS patient_name, du.name AS doctor_name
     FROM bills b JOIN appointments a ON a.id = b.appointment_id
     JOIN patients p ON p.id = a.patient_id JOIN users pu ON pu.id = p.user_id
     JOIN doctors d ON d.id = a.doctor_id JOIN users du ON du.id = d.user_id
     WHERE b.status = ? ORDER BY b.id DESC LIMIT 100`, [status]));
}));

// Records a payment taken at the counter (no real payment gateway)
router.post('/bills/:id/pay', h(async (req, res) => {
  const bill = await db.get(
    `SELECT b.*, p.user_id AS patient_user_id FROM bills b
     JOIN appointments a ON a.id = b.appointment_id JOIN patients p ON p.id = a.patient_id WHERE b.id = ?`, [Number(req.params.id)]);
  if (!bill) throw httpError(404, 'Bill not found');
  if (bill.status !== 'Pending') throw httpError(400, 'This bill is already settled');
  const method = String((req.body || {}).method || '');
  if (!['Cash', 'Card', 'UPI'].includes(method)) throw httpError(400, 'Choose Cash, Card or UPI');
  const gross = Number(bill.amount) + Number(bill.extra_charges);
  const discount = optNum((req.body || {}).discount, 0, gross, 'Discount') || 0;
  const r = await db.run(
    "UPDATE bills SET discount = ?, total = ?, status = 'Paid', payment_method = ?, paid_at = ? WHERE id = ? AND status = 'Pending'",
    [discount, gross - discount, method, now(), bill.id]);
  if (!r.affectedRows) throw httpError(409, 'This bill was just settled by someone else');
  await audit(req, 'BILL_PAID', `bill ${bill.id} ${method} ${gross - discount}`);
  await notify(bill.patient_user_id, `Payment of Rs. ${gross - discount} received. Thank you.`);
  broadcast();
  res.json({ ok: true });
}));

module.exports = router;
