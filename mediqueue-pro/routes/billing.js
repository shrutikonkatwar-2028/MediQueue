// Bills: only reception and admin can see ALL bills and change payment details.
// Patients can only read their own bills (GET /api/patient/bills) and have no write access at all.
const router = require('express').Router();
const db = require('../db');
const { auth, role } = require('../middleware/auth');
const { h, httpError, now, str, optNum } = require('../utils/helpers');
const { audit } = require('../utils/audit');
const { broadcast, notify } = require('../realtime');

router.use(auth, role('receptionist', 'admin'));

const BILL_SQL = `
  SELECT b.id, b.amount, b.extra_charges, b.discount, b.total, b.status, b.payment_method, b.paid_at,
         a.token_no, a.date, pu.name AS patient_name, du.name AS doctor_name, p.user_id AS patient_user_id
  FROM bills b JOIN appointments a ON a.id = b.appointment_id
  JOIN patients p ON p.id = a.patient_id JOIN users pu ON pu.id = p.user_id
  JOIN doctors d ON d.id = a.doctor_id JOIN users du ON du.id = d.user_id`;

router.get('/', h(async (req, res) => {
  const status = ['Pending', 'Paid', 'Waived'].includes(req.query.status) ? req.query.status : null;
  const q = str(req.query.q, 60).replace(/[%_]/g, '');
  const like = `%${q}%`;
  const rows = await db.all(
    `${BILL_SQL} WHERE (? IS NULL OR b.status = ?) AND (pu.name LIKE ? OR a.token_no LIKE ? OR du.name LIKE ?)
     ORDER BY b.id DESC LIMIT 200`, [status, status, like, like, like]);
  rows.forEach(r => delete r.patient_user_id);
  res.json(rows);
}));

// Correct or settle a bill: extra charges, discount, status and payment method
router.put('/:id', h(async (req, res) => {
  const bill = await db.get(`${BILL_SQL} WHERE b.id = ?`, [Number(req.params.id)]);
  if (!bill) throw httpError(404, 'Bill not found');
  const b = req.body || {};

  const extra = b.extra_charges === undefined ? Number(bill.extra_charges) : (optNum(b.extra_charges, 0, 100000, 'Extra charges') ?? 0);
  const gross = Number(bill.amount) + extra;
  let discount = b.discount === undefined ? Number(bill.discount) : (optNum(b.discount, 0, gross, 'Discount') ?? 0);
  if (discount > gross) throw httpError(400, 'Discount cannot be more than the bill amount');
  const status = b.status === undefined ? bill.status : String(b.status);
  if (!['Pending', 'Paid', 'Waived'].includes(status)) throw httpError(400, 'Status must be Pending, Paid or Waived');
  let method = b.payment_method === undefined ? bill.payment_method : (b.payment_method || null);
  if (status === 'Paid' && !['Cash', 'Card', 'UPI'].includes(method)) throw httpError(400, 'Choose Cash, Card or UPI for a paid bill');
  if (status !== 'Paid') method = null;
  if (status === 'Waived') discount = gross;
  const total = gross - discount;

  let sql = 'UPDATE bills SET extra_charges = ?, discount = ?, total = ?, status = ?, payment_method = ?';
  const params = [extra, discount, total, status, method];
  if (status === 'Paid' && bill.status !== 'Paid') { sql += ', paid_at = ?'; params.push(now()); }
  else if (status !== 'Paid') sql += ', paid_at = NULL';
  await db.run(sql + ' WHERE id = ?', [...params, bill.id]);

  await audit(req, 'BILL_EDITED', `bill ${bill.id}: ${bill.status} Rs.${bill.total} -> ${status} Rs.${total}${method ? ' ' + method : ''}`);
  if (status === 'Paid' && bill.status !== 'Paid') await notify(bill.patient_user_id, `Payment of Rs. ${total} received. Thank you.`);
  broadcast();
  res.json({ ok: true, total });
}));

module.exports = router;
