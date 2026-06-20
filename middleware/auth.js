const dbPromise = require('../db');

async function requireLogin(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/login');
  }
  try {
    const db = await dbPromise;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    if (!user) {
      req.session.destroy(() => res.redirect('/login'));
      return;
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

function requireManager(req, res, next) {
  if (!req.user || req.user.role !== 'manager') {
    return res.status(403).send('无权限访问');
  }
  next();
}

function requireStaff(req, res, next) {
  if (!req.user || req.user.role !== 'staff') {
    return res.status(403).send('无权限访问');
  }
  next();
}

function injectUser(req, res, next) {
  res.locals.currentUser = req.user || null;
  res.locals.flash = req.session.flash || null;
  req.session.flash = null;
  next();
}

module.exports = { requireLogin, requireManager, requireStaff, injectUser };
