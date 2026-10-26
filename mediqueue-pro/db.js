// Picks the database driver from DB_TYPE in .env:  sqlite (default, no setup)  or  mysql
// Every driver offers the same async API: get / all / run / tx / clearAll / close
const { DB_TYPE } = require('./config');
module.exports = DB_TYPE === 'mysql' ? require('./drivers/mysql') : require('./drivers/sqlite');
