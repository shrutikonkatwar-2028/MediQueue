const crypto = require('crypto');
const db = require('../db');
const { localDate, addDays, now, httpError, ageFromDob, WEEKDAYS } = require('./helpers');
const { SYMPTOMS, baseScore, totalScore, label } = require('./priority');

// Appointment + patient details in one row
const APPT_PATIENT_SQL = `
  SELECT a.*, u.name AS patient_name, u.phone AS patient_phone, p.user_id AS patient_user_id,
         p.dob, p.gender, p.blood_group, p.medical_history, p.allergies, p.chronic_flag
  FROM appointments a
  JOIN patients p ON p.id = a.patient_id
  JOIN users u ON u.id = p.user_id`;

function decorate(r) {
  if (r.dob) r.age = ageFromDob(r.dob);
  const waiting = r.status === 'Waiting';
  r.total_score = totalScore(r.priority_score, waiting ? r.arrived_at : null);
  r.label = label(r.total_score);
  r.waited_min = waiting && r.arrived_at
    ? Math.max(0, Math.round((Date.now() - Date.parse(r.arrived_at)) / 60000)) : 0;
  return r;
}

// Waiting patients of a doctor, highest live priority score first (ties: who arrived first)
async function getQueue(doctorId, date = localDate()) {
  const rows = (await db.all(
    `${APPT_PATIENT_SQL} WHERE a.doctor_id = ? AND a.date = ? AND a.status = 'Waiting'`,
    [doctorId, date])).map(decorate);
  rows.sort((a, b) => b.total_score - a.total_score || Date.parse(a.arrived_at) - Date.parse(b.arrived_at));
  return rows;
}

// exec = db (own transaction) or a transaction object `t` when the caller already has one
async function createAppointment(input, exec = db) {
  const { patientId, doctorId, date, category, symptoms, source = 'online', checkin = false } = input;
  if (!SYMPTOMS[category]) throw httpError(400, 'Choose a valid symptom type');
  const today = localDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || date < today || date > localDate(addDays(new Date(), 30))) {
    throw httpError(400, 'Choose a date within the next 30 days');
  }
  const text = String(symptoms || '').trim().slice(0, 500);

  const body = async t => {
    // Lock the doctor row so two patients booking at the same moment get different tokens
    const doc = await t.get('SELECT * FROM doctors WHERE id = ? FOR UPDATE', [doctorId]);
    if (!doc) throw httpError(404, 'Doctor not found');
    const du = await t.get('SELECT is_active FROM users WHERE id = ?', [doc.user_id]);
    if (!du || !du.is_active) throw httpError(400, 'This doctor is not available for booking');
    const pat = await t.get('SELECT * FROM patients WHERE id = ?', [patientId]);
    if (!pat) throw httpError(404, 'Patient profile not found');

    if (source === 'online') {
      const days = await t.all('SELECT weekday FROM doctor_schedules WHERE doctor_id = ?', [doctorId]);
      const wd = new Date(date + 'T00:00:00').getDay();
      if (days.length && !days.some(s => s.weekday === wd)) {
        throw httpError(400, `This doctor does not see patients on ${WEEKDAYS[wd]}s`);
      }
      if (category !== 'emergency') {
        const taken = (await t.get(
          "SELECT COUNT(*) c FROM appointments WHERE doctor_id = ? AND date = ? AND status <> 'Cancelled'",
          [doctorId, date])).c;
        if (taken >= doc.max_daily_patients) {
          throw httpError(409, 'All appointments with this doctor are taken on that date. Please choose another date');
        }
      }
    }

    const dup = await t.get(
      `SELECT id FROM appointments WHERE patient_id = ? AND doctor_id = ? AND date = ?
       AND status IN ('Booked','Waiting','In consultation')`, [patientId, doctorId, date]);
    if (dup) throw httpError(409, 'There is already an active booking with this doctor on that date');

    const base = baseScore({ category, age: ageFromDob(pat.dob), chronic: pat.chronic_flag });
    const n = (await t.get('SELECT COUNT(*) c FROM appointments WHERE doctor_id = ? AND date = ?', [doctorId, date])).c + 1;
    const token = `${String.fromCharCode(65 + ((doctorId - 1) % 26))}-${String(n).padStart(2, '0')}`;
    const ts = now();
    const r = await t.run(
      `INSERT INTO appointments (patient_id, doctor_id, date, symptoms, symptom_category, priority_score,
         token_no, status, source, qr_code, created_at, arrived_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [patientId, doctorId, date, text, category, base, token, checkin ? 'Waiting' : 'Booked', source,
       crypto.randomBytes(12).toString('hex'), ts, checkin ? ts : null]);
    return r.insertId;
  };
  return exec.inTx ? body(exec) : db.tx(body);
}

// Idempotent: an already-waiting patient is simply returned
async function checkIn(appointmentId) {
  const a = await db.get('SELECT * FROM appointments WHERE id = ?', [appointmentId]);
  if (!a) throw httpError(404, 'Appointment not found');
  if (a.status === 'Waiting' || a.status === 'In consultation') return a;
  if (a.status !== 'Booked') throw httpError(400, `Cannot check in a ${a.status.toLowerCase()} appointment`);
  if (a.date !== localDate()) throw httpError(400, `Check-in opens on the appointment date (${a.date})`);
  await db.run("UPDATE appointments SET status = 'Waiting', arrived_at = ? WHERE id = ? AND status = 'Booked'", [now(), a.id]);
  return db.get('SELECT * FROM appointments WHERE id = ?', [a.id]);
}

// A patient who missed their call (No-show) can be put back in the queue the same day
async function requeue(appointmentId) {
  const a = await db.get('SELECT * FROM appointments WHERE id = ?', [appointmentId]);
  if (!a) throw httpError(404, 'Appointment not found');
  if (a.status !== 'No-show' || a.date !== localDate()) throw httpError(400, 'Only a missed appointment from today can be put back in the queue');
  await db.run("UPDATE appointments SET status = 'Waiting', arrived_at = ?, called_at = NULL WHERE id = ?", [now(), a.id]);
}

// Everything the patient's live tracker needs for one appointment
async function trackInfo(a) {
  const doc = await db.get(
    `SELECT d.room, d.status, d.avg_consult_time, u.name AS doctor_name, s.name AS specialty
     FROM doctors d JOIN users u ON u.id = d.user_id JOIN specialties s ON s.id = d.specialty_id
     WHERE d.id = ?`, [a.doctor_id]);
  decorate(a);
  const info = {
    id: a.id, date: a.date, token_no: a.token_no, status: a.status, source: a.source,
    symptoms: a.symptoms, symptom_category: a.symptom_category,
    doctor_id: a.doctor_id, doctor_name: doc.doctor_name, specialty: doc.specialty,
    room: doc.room, doctor_status: doc.status, avg_consult_time: doc.avg_consult_time,
    total_score: a.total_score, label: a.label
  };
  const today = localDate();
  if (a.status === 'Waiting' && a.date === today) {
    const q = await getQueue(a.doctor_id, today);
    const idx = q.findIndex(x => x.id === a.id);
    info.position = idx + 1;
    info.patients_ahead = idx;
    info.estimated_wait = idx * doc.avg_consult_time;       // patients ahead x avg consultation time
  }
  if (a.status === 'Booked' && a.date === today) {
    info.waiting_now = (await db.get(
      "SELECT COUNT(*) c FROM appointments WHERE doctor_id = ? AND date = ? AND status = 'Waiting'",
      [a.doctor_id, today])).c;
  }
  return info;
}

// Unused old bookings should not block new ones
async function expireOldAppointments() {
  const today = localDate();
  await db.run("UPDATE appointments SET status = 'No-show' WHERE date < ? AND status = 'Booked'", [today]);
  await db.run("UPDATE appointments SET status = 'Cancelled' WHERE date < ? AND status = 'Waiting'", [today]);
}

module.exports = {
  APPT_PATIENT_SQL, decorate, getQueue, createAppointment, checkIn, requeue, trackInfo, expireOldAppointments
};
