const express = require('express');
const dbPromise = require('../db');
const router = express.Router();

router.get('/login', (req, res) => {
  res.render('login', { error: null, username: '' });
});

router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;
    const db = await dbPromise;
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

    if (!user || user.password !== password) {
      return res.render('login', { error: '用户名或密码错误', username });
    }

    req.session.userId = user.id;
    req.session.flash = { type: 'success', message: `欢迎回来，${user.name}！` };
    res.redirect('/');
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
