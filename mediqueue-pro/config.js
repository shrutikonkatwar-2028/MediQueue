require('dotenv').config();

const config = {
  PORT: Number(process.env.PORT || 3000),
  JWT_SECRET: process.env.JWT_SECRET || 'dev-secret-change-me',
  BASE_URL: process.env.BASE_URL || '',
  HOSPITAL_NAME: process.env.HOSPITAL_NAME || 'MediQueue Hospital',
  // sqlite = zero setup (default). mysql = separate MySQL / XAMPP server
  DB_TYPE: (process.env.DB_TYPE || 'sqlite').toLowerCase(),
  SQLITE_FILE: require('path').resolve(__dirname, process.env.SQLITE_FILE || 'data/mediqueue.db'),
  DB: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'mediqueue'
  }
};

if (process.env.NODE_ENV === 'production' && config.JWT_SECRET.length < 32) {
  console.error('Set a long random JWT_SECRET (32+ characters) in production.');
  process.exit(1);
}
module.exports = config;
