const db = require('../db');

const VISIT_SQL = `
  SELECT a.id, a.date, a.token_no, a.status, a.symptoms, a.completed_at,
         u.name AS doctor_name, s.name AS specialty,
         pr.diagnosis, pr.notes, pr.medicines, pr.tests_advised, pr.follow_up_date,
         pr.bp, pr.temperature, pr.pulse, pr.weight,
         f.rating, f.comment AS feedback
  FROM appointments a
  JOIN doctors d ON d.id = a.doctor_id
  JOIN users u ON u.id = d.user_id
  JOIN specialties s ON s.id = d.specialty_id
  LEFT JOIN prescriptions pr ON pr.appointment_id = a.id
  LEFT JOIN feedback f ON f.appointment_id = a.id`;

// Completed visits only (used by doctors)
const completedVisits = patientId => db.all(
  `${VISIT_SQL} WHERE a.patient_id = ? AND a.status = 'Completed' ORDER BY a.date DESC, a.id DESC LIMIT 100`, [patientId]);

// Completed + cancelled + missed (used by the patient)
const allVisits = patientId => db.all(
  `${VISIT_SQL} WHERE a.patient_id = ? AND a.status IN ('Completed','Cancelled','No-show')
   ORDER BY a.date DESC, a.id DESC LIMIT 200`, [patientId]);

module.exports = { completedVisits, allVisits };
