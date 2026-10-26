// Loads dummy data:  npm run seed
// WARNING: wipes ALL existing data first. Never run it on a database with real patient data.
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('./db');
const { localDate, addDays, dobFromAge } = require('./utils/helpers');
const { baseScore } = require('./utils/priority');

const rnd = n => Math.floor(Math.random() * n);
const pick = arr => arr[rnd(arr.length)];
const shuffle = arr => arr.map(v => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
const at = (date, hh, mm) => new Date(`${date}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`);
const minsAgo = m => new Date(Date.now() - m * 60000);

const SPECIALTIES = ['General Medicine', 'Cardiology', 'Pediatrics', 'Orthopedics', 'Neurology', 'Dermatology', 'Gynecology', 'ENT'];
// name, specialty, room, status, avg minutes, experience, fee, daily limit, qualification, working weekdays (0=Sun)
const MON_SAT = [1, 2, 3, 4, 5, 6], MWF = [1, 3, 5];
const DOCTORS = [
  ['Meera Nair', 'General Medicine', '101', 'In OPD', 8, 12, 400, 40, 'MBBS, MD (Medicine)', MON_SAT],
  ['Rajesh Iyer', 'Cardiology', '204', 'In OPD', 15, 18, 1000, 30, 'MBBS, DM (Cardiology)', MON_SAT],
  ['Sunita Deshmukh', 'Pediatrics', '110', 'In OPD', 10, 9, 500, 40, 'MBBS, DCH', MON_SAT],
  ['Arvind Patil', 'Orthopedics', '305', 'In surgery', 12, 15, 800, 30, 'MBBS, MS (Ortho)', MON_SAT],
  ['Farah Khan', 'Neurology', '210', 'On break', 20, 11, 1200, 20, 'MBBS, DM (Neurology)', MWF],
  ['Vikas Mehta', 'Dermatology', '115', 'In OPD', 8, 7, 600, 40, 'MBBS, MD (Skin)', MON_SAT],
  ['Kavita Joshi', 'Gynecology', '120', 'On ward round', 15, 14, 800, 30, 'MBBS, MS (OBG)', MON_SAT],
  ['Sanjay Kulkarni', 'ENT', '125', 'In OPD', 10, 10, 600, 35, 'MBBS, MS (ENT)', MON_SAT],
  ['Pooja Shah', 'General Medicine', '102', 'In OPD', 8, 6, 300, 40, 'MBBS', MON_SAT],
  ['Imran Shaikh', 'Cardiology', '205', 'Not in hospital', 15, 20, 1100, 25, 'MBBS, DM (Cardiology)', MWF],
  ['Neha Verma', 'Pediatrics', '111', 'In OPD', 10, 5, 450, 40, 'MBBS, MD (Pediatrics)', MON_SAT],
  ['Amit Gupta', 'Orthopedics', '306', 'In OPD', 12, 8, 700, 30, 'MBBS, MS (Ortho)', MON_SAT]
];

const FIRST = ['Aarav', 'Priya', 'Rohan', 'Sneha', 'Vikram', 'Anjali', 'Karan', 'Neha', 'Rahul', 'Pooja', 'Amit', 'Kavita', 'Sanjay', 'Meera', 'Arjun', 'Divya', 'Nikhil', 'Isha', 'Manish', 'Ritu', 'Suresh', 'Zoya', 'Yusuf', 'Ayesha', 'Kabir', 'Tanvi', 'Harsh', 'Shreya', 'Dev', 'Nisha'];
const LAST = ['Sharma', 'Patil', 'Deshmukh', 'Khan', 'Iyer', 'Mehta', 'Shah', 'Joshi', 'Kulkarni', 'Nair', 'Verma', 'Gupta', 'Singh', 'Pawar', 'Shaikh'];
const HISTORIES = ['', '', '', 'Diabetes (type 2)', 'High blood pressure', 'Asthma', 'Heart disease', 'Thyroid disorder', 'Allergic to penicillin', 'Arthritis', 'Migraine'];
const CHRONIC_WORDS = ['Diabetes', 'High blood pressure', 'Asthma', 'Heart disease', 'Thyroid', 'Arthritis'];
const BLOODS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'O+', 'O-'];
const MEDICINES = ['Paracetamol 500mg', 'Ibuprofen 400mg', 'Amoxicillin 500mg', 'Azithromycin 500mg', 'Cetirizine 10mg', 'Pantoprazole 40mg', 'Omeprazole 20mg', 'Metformin 500mg', 'Amlodipine 5mg', 'Atorvastatin 10mg', 'Aspirin 75mg', 'Losartan 50mg', 'Salbutamol inhaler', 'Montelukast 10mg', 'Levothyroxine 50mcg', 'Diclofenac gel', 'Vitamin D3 60000 IU', 'Vitamin B12', 'Calcium + D3', 'ORS sachet', 'Cough syrup (dextromethorphan)', 'Domperidone 10mg', 'Ranitidine 150mg', 'Clopidogrel 75mg', 'Metoprolol 25mg', 'Gabapentin 300mg', 'Naproxen 250mg', 'Loratadine 10mg', 'Ciprofloxacin 500mg', 'Doxycycline 100mg', 'Fluconazole 150mg', 'Clotrimazole cream', 'Hydrocortisone cream', 'Zinc 20mg', 'Iron + Folic acid', 'Ondansetron 4mg', 'Pregabalin 75mg', 'Insulin glargine', 'Nasal decongestant drops', 'Multivitamin'];
const NOTES = ['Rest and plenty of fluids.', 'Review after 5 days if symptoms continue.', 'Advised light diet and regular walking.', 'Avoid cold drinks and dust.', 'Condition stable. Continue current medicines.', 'Physiotherapy exercises advised.'];
const DIAGNOSES = ['Viral fever', 'Seasonal allergy', 'Hypertension, controlled', 'Upper respiratory infection', 'Gastritis', 'Lower back strain', 'Migraine', 'Routine checkup, normal', 'Type 2 diabetes, follow-up'];
const TESTS = ['', '', 'CBC, blood sugar', 'X-ray chest', 'Lipid profile', 'Thyroid profile'];
const SYMPTOM_TEXT = {
  emergency: ['Chest pain since morning', 'Difficulty in breathing', 'Heavy bleeding from a wound'],
  high: ['High fever for 3 days', 'Suspected fracture in left arm', 'Knee injury while playing'],
  mild: ['Cold and cough', 'Sore throat and mild cough', 'Runny nose since two days'],
  routine: ['Routine health checkup', 'Follow-up visit', 'Blood pressure check']
};
const randomCategory = () => { const r = Math.random(); return r < 0.08 ? 'emergency' : r < 0.33 ? 'high' : r < 0.63 ? 'mild' : 'routine'; };

(async () => {
  await db.clearAll(['notifications', 'audit_logs', 'feedback', 'bills', 'prescriptions', 'appointments',
    'doctor_schedules', 'patients', 'doctors', 'specialties', 'medicines', 'users']);

  const H = {
    admin: await bcrypt.hash('admin123', 10), doctor: await bcrypt.hash('doctor123', 10),
    patient: await bcrypt.hash('patient123', 10), reception: await bcrypt.hash('reception123', 10)
  };
  const addUser = async (name, email, phone, hash, role) =>
    (await db.run('INSERT INTO users (name,email,phone,password,role,created_at) VALUES (?,?,?,?,?,?)',
      [name, email, phone, hash, role, new Date()])).insertId;

  await addUser('Hospital Admin', 'admin@mediqueue.com', '9000000001', H.admin, 'admin');
  await addUser('Front Desk', 'reception@mediqueue.com', '9000000002', H.reception, 'receptionist');

  const spec = {};
  for (const s of SPECIALTIES) spec[s] = (await db.run('INSERT INTO specialties (name) VALUES (?)', [s])).insertId;
  for (const m of MEDICINES) await db.run('INSERT INTO medicines (name) VALUES (?)', [m]);

  // Doctors + weekly schedules
  const doctorIds = [], doctorFee = {};
  for (let i = 0; i < DOCTORS.length; i++) {
    const [name, sp, room, status, avg, exp, fee, max, qual, days] = DOCTORS[i];
    const email = i === 0 ? 'doctor@mediqueue.com' : `dr.${name.split(' ')[0].toLowerCase()}@mediqueue.com`;
    const uid = await addUser(name, email, `90000${100 + i}`, H.doctor, 'doctor');
    const id = (await db.run(
      `INSERT INTO doctors (user_id,specialty_id,room,status,avg_consult_time,experience,consultation_fee,max_daily_patients,qualification)
       VALUES (?,?,?,?,?,?,?,?,?)`, [uid, spec[sp], room, status, avg, exp, fee, max, qual])).insertId;
    doctorIds.push(id); doctorFee[id] = fee;
    for (const wd of days) {
      await db.run('INSERT INTO doctor_schedules (doctor_id,weekday,start_time,end_time) VALUES (?,?,?,?)', [id, wd, '09:00', '17:00']);
    }
  }

  // Patients (first one is the test account)
  const patientIds = [];
  const addPatient = async (name, email, age, history, chronic) => {
    const uid = await addUser(name, email, `98${String(10000000 + rnd(89999999))}`, H.patient, 'patient');
    return (await db.run(
      `INSERT INTO patients (user_id,dob,gender,blood_group,medical_history,chronic_flag,address,emergency_contact)
       VALUES (?,?,?,?,?,?,?,?)`,
      [uid, dobFromAge(age), pick(['Male', 'Female']), pick(BLOODS), history || null, chronic ? 1 : 0,
       `${1 + rnd(200)}, ${pick(['MG Road', 'Station Road', 'College Road', 'Gandhi Nagar'])}, Nashik`,
       `${pick(FIRST)} ${pick(LAST)} (${pick(['Spouse', 'Parent', 'Sibling'])}) 98${String(10000000 + rnd(89999999))}`])).insertId;
  };
  patientIds.push(await addPatient('Test Patient', 'patient@mediqueue.com', 34, '', 0));
  for (let i = 1; i < 40; i++) {
    const r = Math.random();
    const age = r < 0.12 ? 1 + rnd(4) : r < 0.35 ? 61 + rnd(25) : 6 + rnd(54);
    const history = pick(HISTORIES);
    patientIds.push(await addPatient(`${pick(FIRST)} ${pick(LAST)}`, `patient${i}@mediqueue.com`, age,
      history, CHRONIC_WORDS.some(w => history.startsWith(w))));
  }

  // Appointment helper (tokens are numbered per doctor and day, like the real booking code)
  const counters = {};
  const addAppt = async ({ patientId, doctorId, date, category, status, arrivedAt = null, calledAt = null, completedAt = null, bill = null }) => {
    const pat = await db.get('SELECT dob, chronic_flag FROM patients WHERE id = ?', [patientId]);
    const age = new Date().getFullYear() - Number(pat.dob.slice(0, 4));
    const key = `${doctorId}|${date}`;
    counters[key] = (counters[key] || 0) + 1;
    const token = `${String.fromCharCode(65 + ((doctorId - 1) % 26))}-${String(counters[key]).padStart(2, '0')}`;
    const created = arrivedAt ? new Date(arrivedAt.getTime() - 4 * 3600e3) : at(date, 7, 0);
    const id = (await db.run(
      `INSERT INTO appointments (patient_id,doctor_id,date,symptoms,symptom_category,priority_score,token_no,status,source,
         qr_code,created_at,arrived_at,called_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [patientId, doctorId, date, pick(SYMPTOM_TEXT[category]), category,
       baseScore({ category, age, chronic: pat.chronic_flag }), token, status, 'online',
       crypto.randomBytes(12).toString('hex'), created, arrivedAt, calledAt, completedAt])).insertId;
    if (status === 'Completed') {
      const meds = shuffle(MEDICINES).slice(0, 1 + rnd(3)).map(m => `${m} - ${pick(['1-0-1', '0-0-1', '1-1-1', '1-0-0'])} - ${pick([3, 5, 7])} days`);
      const follow = Math.random() < 0.4 ? localDate(addDays(new Date(), 3 + rnd(20))) : null;
      await db.run(
        `INSERT INTO prescriptions (appointment_id,diagnosis,notes,medicines,tests_advised,follow_up_date,bp,temperature,pulse,weight,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [id, pick(DIAGNOSES), pick(NOTES), meds.join('\n'), pick(TESTS) || null, follow,
         `${110 + rnd(30)}/${70 + rnd(20)}`, (36.4 + Math.random() * 1.6).toFixed(1), 66 + rnd(30), (45 + rnd(50)).toFixed(1), completedAt]);
      const fee = doctorFee[doctorId], paid = bill ? bill === 'Paid' : Math.random() < 0.9;
      await db.run('INSERT INTO bills (appointment_id,amount,extra_charges,discount,total,status,payment_method,paid_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        [id, fee, 0, 0, fee, paid ? 'Paid' : 'Pending', paid ? pick(['Cash', 'UPI', 'Card']) : null, paid ? completedAt : null, completedAt]);
      if (date < localDate() && Math.random() < 0.5) {
        await db.run('INSERT INTO feedback (appointment_id,rating,comment,created_at) VALUES (?,?,?,?)',
          [id, 3 + rnd(3), pick(['Very helpful doctor', 'Short waiting time', 'Good explanation', null]), completedAt]);
      }
    }
    return id;
  };

  // Past visits: 55 appointments over the last 30 days (also gives the admin charts some data)
  const addPast = async (patientId, doctorId, daysAgo, status) => {
    const date = localDate(addDays(new Date(), -daysAgo));
    const start = at(date, 9 + rnd(6), rnd(50)), done = status === 'Completed';
    const plus = m => new Date(start.getTime() + m * 60000);
    await addAppt({ patientId, doctorId, date, category: randomCategory(), status,
      arrivedAt: done ? start : null, calledAt: done ? plus(5 + rnd(25)) : null, completedAt: done ? plus(45) : null });
  };
  await addPast(patientIds[0], doctorIds[0], 12, 'Completed');
  await addPast(patientIds[0], doctorIds[1], 25, 'Completed');
  for (let i = 0; i < 53; i++) {
    await addPast(pick(patientIds.slice(1)), pick(doctorIds), 1 + rnd(30), Math.random() < 0.88 ? 'Completed' : 'Cancelled');
  }

  // Today: live queues
  const today = localDate();
  const pool = shuffle(patientIds.slice(1));
  const demo = [['routine', 'Waiting', 48], ['mild', 'Waiting', 40], ['emergency', 'Waiting', 5], ['high', 'Waiting', 30],
                ['routine', 'Waiting', 22], ['mild', 'Waiting', 12], ['routine', 'Booked', 0], ['mild', 'Booked', 0]];
  for (const [category, status, ago] of demo) {
    await addAppt({ patientId: pool.pop(), doctorId: doctorIds[0], date: today, category, status,
      arrivedAt: status === 'Waiting' ? minsAgo(ago) : null });
  }
  const working = doctorIds.filter((id, i) => DOCTORS[i][3] === 'In OPD' && i !== 0);
  for (let i = 0; i < 18 && pool.length; i++) {
    const r = Math.random(), status = r < 0.65 ? 'Waiting' : r < 0.9 ? 'Booked' : 'Completed', ago = 5 + rnd(60);
    await addAppt({ patientId: pool.pop(), doctorId: pick(working), date: today, category: randomCategory(), status,
      arrivedAt: status === 'Booked' ? null : minsAgo(ago + (status === 'Completed' ? 40 : 0)),
      calledAt: status === 'Completed' ? minsAgo(ago + 20) : null,
      completedAt: status === 'Completed' ? minsAgo(ago + 10) : null, bill: 'Pending' });
  }
  // Doctor 2 is already with a patient
  const first = await db.get("SELECT id FROM appointments WHERE doctor_id = ? AND date = ? AND status = 'Waiting' ORDER BY arrived_at LIMIT 1", [doctorIds[1], today]);
  if (first) await db.run("UPDATE appointments SET status = 'In consultation', called_at = ? WHERE id = ?", [minsAgo(4), first.id]);

  const testPatientUser = (await db.get('SELECT user_id FROM patients WHERE id = ?', [patientIds[0]])).user_id;
  await db.run('INSERT INTO notifications (user_id,message,created_at) VALUES (?,?,?)',
    [testPatientUser, 'Welcome to MediQueue. Book your first appointment from the Book tab.', new Date()]);

  const c = async t => (await db.get(`SELECT COUNT(*) c FROM ${t}`)).c;
  console.log(`Seeded: ${await c('specialties')} specialties, ${await c('doctors')} doctors, ${await c('patients')} patients, ` +
    `${await c('appointments')} appointments, ${await c('bills')} bills, ${await c('medicines')} medicines`);
  console.log('\nTest accounts:');
  console.log('  Admin        admin@mediqueue.com      / admin123');
  console.log('  Doctor       doctor@mediqueue.com     / doctor123');
  console.log('  Patient      patient@mediqueue.com    / patient123');
  console.log('  Receptionist reception@mediqueue.com  / reception123');
  await db.close();
})().catch(e => { console.error('Seeding failed:', e.message); process.exit(1); });
