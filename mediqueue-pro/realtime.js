const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const db = require('./db');
const { JWT_SECRET } = require('./config');
const { now } = require('./utils/helpers');

let io = null;

function init(httpServer) {
  io = new Server(httpServer);
  io.use((socket, next) => {
    try {
      socket.user = jwt.verify(socket.handshake.auth.token, JWT_SECRET);
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });
  io.on('connection', socket => {
    socket.join('user:' + socket.user.id);
    socket.join('role:' + socket.user.role);
  });
}

// Tell every connected screen to refresh its data
function broadcast() {
  if (io) io.emit('queue:update');
}

// Save an in-app notification and push it live
async function notify(userId, message) {
  await db.run('INSERT INTO notifications (user_id, message, created_at) VALUES (?,?,?)', [userId, message, now()]);
  if (io) io.to('user:' + userId).emit('notification', { message });
}

// Live push for an announcement (rows are saved by the caller)
function announce(roles, message) {
  if (io) roles.forEach(r => io.to('role:' + r).emit('notification', { message }));
}

module.exports = { init, broadcast, notify, announce };
