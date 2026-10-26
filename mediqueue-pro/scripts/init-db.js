// Creates the database tables.  Run: npm run db:init   (safe to repeat, never deletes data)
const fs = require('fs');
const path = require('path');
const { DB, DB_TYPE } = require('../config');

(async () => {
  const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  if (DB_TYPE === 'mysql') {
    const mysql = require('mysql2/promise');
    if (!/^[A-Za-z0-9_]+$/.test(DB.database)) throw new Error('DB_NAME may only contain letters, numbers and underscores');
    const conn = await mysql.createConnection({
      host: DB.host, port: DB.port, user: DB.user, password: DB.password, multipleStatements: true
    });
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await conn.query(`USE \`${DB.database}\``);
    await conn.query(schema);
    await conn.end();
    console.log(`MySQL database "${DB.database}" is ready (tables created).`);
  } else {
    const db = require('../db');
    db.initSchema(schema);
    await db.close();
    console.log('SQLite database is ready (tables created).');
  }
})().catch(e => {
  console.error('Database setup failed:', e.message);
  if (DB_TYPE === 'mysql') console.error('Check that MySQL is running and that DB_HOST, DB_USER, DB_PASSWORD are correct in your .env file.');
  process.exit(1);
});
