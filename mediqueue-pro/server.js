const express = require('express');
const http = require('http');
const path = require('path');
const { PORT, DB_TYPE } = require('./config');
const db = require('./db');
const realtime = require('./realtime');
const { expireOldAppointments } = require('./utils/queue');

const app = express();
const server = http.createServer(app);
realtime.init(server);

app.disable('x-powered-by');
app.set('trust proxy', 1);           // correct client IP behind nginx / a hosting proxy
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/patient', require('./routes/patient'));
app.use('/api/doctor', require('./routes/doctor'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/reception', require('./routes/reception'));
app.use('/api/billing', require('./routes/billing'));
app.use('/api', require('./routes/common'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request body' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server' });
});

(async () => {
  try {
    await db.get('SELECT 1 AS ok');
  } catch (e) {
    console.error(`\nCannot open the ${DB_TYPE} database: ` + e.message);
    if (DB_TYPE === 'mysql') console.error('1) Start MySQL (XAMPP: press Start next to MySQL)  2) Check DB_USER / DB_PASSWORD in .env');
    console.error('First time? Run:  npm run setup\n');
    process.exit(1);
  }
  try {
    await expireOldAppointments();
  } catch (e) {
    console.error('\nDatabase tables not found. Run:  npm run setup\n');
    process.exit(1);
  }
  setInterval(() => expireOldAppointments().then(realtime.broadcast).catch(console.error), 60 * 60 * 1000);
  server.listen(PORT, () => console.log(`MediQueue running at http://localhost:${PORT}`));
})();

process.on('unhandledRejection', e => console.error('Unhandled error:', e));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.close(); db.close().finally(() => process.exit(0)); });
