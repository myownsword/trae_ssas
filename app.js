const express = require('express');
const session = require('express-session');
const methodOverride = require('method-override');
const path = require('path');
const dbPromise = require('./db');
const { requireLogin, requireManager, injectUser } = require('./middleware/auth');
const {
  statusLabels, startOfWeek, endOfWeek, formatDate,
  getUnreadNotificationCount
} = require('./utils');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: 'ssas-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

app.use(async (req, res, next) => {
  if (req.session.userId) {
    try {
      const db = await dbPromise;
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
      req.user = user;
      if (user) {
        res.locals.unreadNotificationCount = getUnreadNotificationCount(db, user.id);
      } else {
        res.locals.unreadNotificationCount = 0;
      }
    } catch (err) {
      return next(err);
    }
  } else {
    res.locals.unreadNotificationCount = 0;
  }
  next();
});
app.use(injectUser);

app.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('login', { error: null, username: '' });
});

app.use('/auth', require('./routes/auth'));
app.use('/shifts', requireLogin, require('./routes/shifts'));
app.use('/swap', requireLogin, require('./routes/swap'));
app.use('/notifications', requireLogin, require('./routes/notifications'));

app.get('/', requireLogin, async (req, res, next) => {
  try {
    const db = await dbPromise;
    if (req.user.role === 'manager') {
      const weekStart = formatDate(startOfWeek(new Date()));
      const weekEnd = formatDate(endOfWeek(new Date()));

      const pendingCount = db.prepare(`
        SELECT COUNT(*) as count FROM swap_requests
        WHERE status = 'pending_approve'
      `).get().count;

      const pendingConfirmCount = db.prepare(`
        SELECT COUNT(*) as count FROM swap_requests
        WHERE status = 'pending_confirm'
      `).get().count;

      const riskShifts = db.prepare(`
        SELECT s.*, u.name as user_name
        FROM shifts s JOIN users u ON s.user_id = u.id
        WHERE s.shift_date >= ? AND s.shift_date <= ? AND s.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM swap_requests sr
          WHERE sr.original_shift_id = s.id AND sr.status IN ('pending_confirm', 'pending_approve', 'approved')
        )
        AND (
          SELECT COUNT(*) FROM shifts s2
          WHERE s2.shift_date = s.shift_date AND s2.status = 'active'
          AND ((s2.start_time <= s.start_time AND s2.end_time > s.start_time)
            OR (s2.start_time < s.end_time AND s2.end_time >= s.end_time)
            OR (s2.start_time >= s.start_time AND s2.end_time <= s.end_time))
        ) <= 1
        ORDER BY s.shift_date ASC, s.start_time ASC
        LIMIT 10
      `).all(weekStart, weekEnd);

      const recentRequests = db.prepare(`
        SELECT sr.*,
          ru.name as requester_name,
          su.name as successor_name
        FROM swap_requests sr
        JOIN users ru ON sr.requester_id = ru.id
        JOIN users su ON sr.successor_id = su.id
        ORDER BY sr.updated_at DESC
        LIMIT 5
      `).all();

      res.render('manager/dashboard', {
        pendingCount,
        pendingConfirmCount,
        riskShifts,
        recentRequests,
        statusLabels,
        weekStart,
        weekEnd
      });
    } else {
      const myRequests = db.prepare(`
        SELECT sr.*,
          su.name as successor_name
        FROM swap_requests sr
        JOIN users su ON sr.successor_id = su.id
        WHERE sr.requester_id = ?
        ORDER BY sr.updated_at DESC
        LIMIT 5
      `).all(req.user.id);

      const assignedRequests = db.prepare(`
        SELECT sr.*,
          ru.name as requester_name
        FROM swap_requests sr
        JOIN users ru ON sr.requester_id = ru.id
        WHERE sr.successor_id = ? AND sr.status = 'pending_confirm'
        ORDER BY sr.updated_at DESC
      `).all(req.user.id);

      res.render('staff/dashboard', {
        myRequests,
        assignedRequests,
        statusLabels
      });
    }
  } catch (err) {
    next(err);
  }
});

app.use((req, res) => {
  res.status(404).render('error', { message: '页面不存在' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { message: '服务器错误: ' + err.message });
});

async function start() {
  await dbPromise;
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`门店换班审批系统启动成功: http://localhost:${PORT}`);
    console.log('请先运行: npm run seed  (首次使用初始化测试数据)');
  });
}

start();
