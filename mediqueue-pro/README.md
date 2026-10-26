# MediQueue Pro - Smart Hospital Queue, Doctor Tracking and Billing

Real-database version of the MediQueue project report. Node.js + Express + **SQLite (default) or MySQL**, live updates with Socket.IO,
plain HTML/CSS/JS frontend (full green hospital theme with the red plus symbol). No build step, no native modules.

## 1. What you need

**Node.js 20 or newer** (LTS) - https://nodejs.org. That is all: the default database is **SQLite** (one file,
`data/mediqueue.db`), nothing else to install.

## 2. Setup (3 commands)

```bash
npm install
npm run setup      # creates the tables and loads dummy data
npm start          # http://localhost:3000
```

`npm run setup` = `npm run db:init` (create tables, safe to repeat) + `npm run seed` (dummy data).
**`npm run seed` deletes ALL data.** Never run it on a database with real patients.
For a real deployment run only `npm run db:init`, then create your admin with
`npm run create-admin -- "Dr. Admin" admin@yourhospital.com "StrongPass123"`.

### Using MySQL instead (optional, for many users)

1. Install MySQL or XAMPP and start MySQL (it must listen on port 3306).
2. Copy `.env.example` to `.env` and set `DB_TYPE=mysql`, `DB_USER`, `DB_PASSWORD` (XAMPP: user `root`, empty password).
3. Run `npm run setup` and `npm start`. The code is the same; only the driver changes (`drivers/mysql.js`).

## 3. Test accounts (after seeding)

| Role         | Email                    | Password     |
|--------------|--------------------------|--------------|
| Patient      | patient@mediqueue.com    | patient123   |
| Doctor       | doctor@mediqueue.com     | doctor123    |
| Admin        | admin@mediqueue.com      | admin123     |
| Receptionist | reception@mediqueue.com  | reception123 |

Other doctors: `dr.rajesh@mediqueue.com`, `dr.sunita@mediqueue.com`, ... (password `doctor123`).
Waiting-room screen (no login): `http://localhost:3000/display.html`.

## 4. What is new compared with the prototype

**Real database:** SQLite or MySQL with foreign keys, unique constraints, indexes and transactions (`schema.sql`).
Date of birth instead of age, UTC timestamps, double-booking and duplicate-token protection (row locking).

**Patient:** profile (allergies, emergency contact, chronic condition), doctor cards with fee, rating, qualification and
weekly timings, booking up to 30 days ahead, live tracker, QR check-in, notifications, visit history with diagnosis,
vitals, tests and follow-up date, **print prescription**, **rate a visit**, **bills + print invoice**.

**Doctor:** status, live priority queue (with allergies and history), Call next, **skip a patient who is not there**,
vitals + diagnosis + medicines + tests + follow-up date + extra charges, automatic bill, 7-day chart, **own weekly schedule**.

**Reception:** walk-in registration with **printable token slip**, **find an existing patient and book**, check-in,
put a missed patient **back in the queue**, **billing counter** (Cash / UPI / Card, discount, receipt).

**Admin:** easy dashboard (colour-coded KPI cards, a "Needs attention" list in plain words, today's patient flow, live doctor queues), live overview with revenue, **doctor management** (fee, daily limit, schedule, enable/disable),
specialties, **user management** (search, disable, reset password, add staff), **billing** (waive), **analytics** with clear colour charts for 7 / 30 / 90 days, each compared with the previous period (appointments vs completed visits,
revenue, payment methods, status and priority mix, busiest hours, waiting time per doctor, specialties, top doctors), **announcements**,
**audit log**, **CSV export** (appointments, bills, patients).

**Everyone:** change password, **waiting-room display board**, strong-password rule, disabled accounts are blocked
immediately, login rate limit.

## 4b. Who can change payments

| Role | Bills |
|------|-------|
| Patient | can only **view and print** their own bills. No write access (the server answers 403) |
| Doctor | creates the bill automatically when a visit is completed, cannot change payments |
| Reception | collect payment, edit extra charges, discount, status (Pending / Paid / Waived) and payment method |
| Admin | same as reception, plus waive bills and export data |

Every bill change is saved in the audit log (who, what, old and new amount). API: `GET /api/billing`, `PUT /api/billing/:id`.

## 5. Smart priority logic

`score = symptom weight + age bonus + condition bonus + waiting-time bonus`

| Factor                                            | Points |
|---------------------------------------------------|--------|
| Chest pain, breathing difficulty, severe bleeding | +100 |
| High fever, fracture or injury                    | +30 |
| Cold or cough                                     | +10 |
| Routine checkup                                   | 0 |
| Age under 5 or over 60 (from date of birth)       | +30 |
| Chronic condition                                 | +20 |
| Each minute waited after check-in                 | +0.5 |

100+ Emergency, 40-99 High, below 40 Normal. Estimated wait = patients ahead x doctor's average consultation time.

## 6. Database tables

`users`, `specialties`, `doctors`, `doctor_schedules`, `patients`, `appointments`, `prescriptions`, `bills`, `feedback`,
`medicines`, `notifications`, `audit_logs` (see `schema.sql`). Appointment statuses:
Booked, Waiting, In consultation, Completed, Cancelled, No-show.
To change the structure later, add a new `.sql` file with `ALTER TABLE ...` and run it in MySQL Workbench/phpMyAdmin.

## 7. Folder structure

```
server.js  config.js  db.js  realtime.js  seed.js  schema.sql
drivers/   sqlite.js (default)  mysql.js
data/      mediqueue.db is created here (SQLite)
scripts/   init-db.js  create-admin.js
utils/     priority.js  queue.js  schedule.js  history.js  audit.js  helpers.js
middleware/auth.js
routes/    auth  patient  doctor  admin  reception  common
public/    index, patient, doctor, admin, reception, display, checkin (.html)  css/style.css  js/*.js
```

## 8. Production checklist

- Set a long random `JWT_SECRET` (32+ characters) and `NODE_ENV=production`
- For many simultaneous users switch to MySQL (`DB_TYPE=mysql`) with a dedicated user (not `root`) that only has rights on the `mediqueue` database
- Put the app behind **HTTPS** (nginx/Caddy or your host); health data must never travel over plain HTTP
- Do not run `npm run seed` on live data. Create the admin with `npm run create-admin`
- Back up daily. SQLite: stop the app and copy `data/mediqueue.db`. MySQL: `mysqldump -u USER -p mediqueue > backup.sql`
- Use a process manager (`pm2 start server.js --name mediqueue`) so it restarts after a crash or reboot
- Real hospitals must also follow local health-data laws (consent, retention, encryption at rest). Payments here are only
  recorded at the counter, there is no online payment gateway or SMS/WhatsApp integration yet

## 9. QR check-in on a phone

The QR contains `http://<BASE_URL>/checkin.html?code=...`. On `localhost` a phone cannot open it, so set
`BASE_URL=http://<your-PC-LAN-IP>:3000` in `.env` (same Wi-Fi). Anyone who scans the code (reception, kiosk) checks the patient in.

## 10. Troubleshooting

| Problem | Fix |
|---------|-----|
| `Cannot connect to MySQL` | Only when `DB_TYPE=mysql`: start MySQL (XAMPP > Start), check `DB_USER` / `DB_PASSWORD` / `DB_PORT`. Or set `DB_TYPE=sqlite` |
| `better-sqlite3` error | Run `npm install` again; use the Node.js LTS version |
| `Access denied for user` | Wrong password in `.env` (XAMPP root password is empty) |
| `Database tables not found` | Run `npm run setup` |
| `Unknown database` | Run `npm run db:init` |
| `EADDRINUSE` | Port 3000 is busy: change `PORT` in `.env` |
| PowerShell blocks `npm` | `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned` |
