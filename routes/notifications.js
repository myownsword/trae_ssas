const express = require('express');
const dbPromise = require('../db');
const router = express.Router();
const { requireLogin } = require('../middleware/auth');
const {
  getUserNotifications,
  getNotificationById,
  markNotificationRead,
  markAllNotificationsRead,
  notificationTypeLabels
} = require('../utils');

router.get('/', requireLogin, async (req, res, next) => {
  try {
    const db = await dbPromise;
    const notifications = getUserNotifications(db, req.user.id);
    res.render('notifications/list', {
      notifications,
      notificationTypeLabels
    });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/read', requireLogin, async (req, res, next) => {
  try {
    const db = await dbPromise;
    const notification = getNotificationById(db, req.params.id);
    if (!notification) {
      return res.status(404).render('error', { message: '通知不存在' });
    }
    if (notification.user_id !== req.user.id) {
      return res.status(403).render('error', { message: '无权限操作此通知' });
    }
    markNotificationRead(db, notification.id, req.user.id);
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.json({ success: true });
    }
    res.redirect('back');
  } catch (err) {
    next(err);
  }
});

router.post('/read-all', requireLogin, async (req, res, next) => {
  try {
    const db = await dbPromise;
    markAllNotificationsRead(db, req.user.id);
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.json({ success: true });
    }
    res.redirect('back');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
