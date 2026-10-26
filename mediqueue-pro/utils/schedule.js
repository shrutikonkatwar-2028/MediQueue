const db = require('../db');
const { httpError } = require('./helpers');

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function parseSchedule(days) {
  if (!Array.isArray(days)) throw httpError(400, 'Invalid schedule');
  const seen = new Set();
  return days.map(d => {
    const weekday = Number(d.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw httpError(400, 'Invalid weekday');
    if (seen.has(weekday)) throw httpError(400, 'A weekday is listed twice');
    seen.add(weekday);
    if (!TIME_RE.test(d.start) || !TIME_RE.test(d.end) || d.start >= d.end) {
      throw httpError(400, 'Each working day needs a start time before its end time');
    }
    return { weekday, start: d.start, end: d.end };
  });
}

async function saveSchedule(doctorId, days) {
  const list = parseSchedule(days);
  await db.tx(async t => {
    await t.run('DELETE FROM doctor_schedules WHERE doctor_id = ?', [doctorId]);
    for (const d of list) {
      await t.run('INSERT INTO doctor_schedules (doctor_id, weekday, start_time, end_time) VALUES (?,?,?,?)',
        [doctorId, d.weekday, d.start, d.end]);
    }
  });
}

const shape = r => ({ weekday: r.weekday, start: String(r.start_time).slice(0, 5), end: String(r.end_time).slice(0, 5) });

async function getSchedule(doctorId) {
  return (await db.all('SELECT weekday, start_time, end_time FROM doctor_schedules WHERE doctor_id = ? ORDER BY weekday', [doctorId])).map(shape);
}

async function getAllSchedules() {
  const rows = await db.all('SELECT doctor_id, weekday, start_time, end_time FROM doctor_schedules ORDER BY weekday');
  const map = {};
  rows.forEach(r => { (map[r.doctor_id] = map[r.doctor_id] || []).push(shape(r)); });
  return map;
}

module.exports = { saveSchedule, getSchedule, getAllSchedules };
