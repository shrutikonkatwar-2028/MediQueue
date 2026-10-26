// Creates a real admin account (use this on a real deployment instead of "npm run seed")
//   node scripts/create-admin.js "Full Name" admin@yourhospital.com "StrongPass123"
const bcrypt = require('bcryptjs');
const db = require('../db');
const { EMAIL_RE, strongPassword } = require('../utils/helpers');

(async () => {
  const [name, email, password] = process.argv.slice(2);
  if (!name || !EMAIL_RE.test(email || '') || !strongPassword(password)) {
    console.log('Usage: node scripts/create-admin.js "Full Name" email@example.com "Password123"');
    console.log('The password needs 8+ characters with at least one letter and one number.');
    process.exit(1);
  }
  if (await db.get('SELECT id FROM users WHERE email = ?', [email.toLowerCase()])) throw new Error('This email already exists');
  await db.run('INSERT INTO users (name,email,password,role,created_at) VALUES (?,?,?,?,?)',
    [name, email.toLowerCase(), await bcrypt.hash(password, 10), 'admin', new Date()]);
  console.log(`Admin account created for ${email}`);
  await db.close();
})().catch(e => { console.error('Failed:', e.message); process.exit(1); });
