const express = require('express');
const dbPromise = require('../db');
const { nowLocal } = require('../db');
const router = express.Router();
const { requireStaff, requireManager } = require('../middleware/auth');
const {
  checkShiftOverlap, getUserAvailableShifts, getAllStaff,
  getShiftById, getSwapRequestById, getTimeline,
  statusLabels, actionLabels,
  createNotification, invalidateNotificationsForRequest
} = require('../utils');

router.get('/', async (req, res, next) => {
  try {
    const db = await dbPromise;
    const { filter } = req.query;
    const userId = req.user.id;
    const isManager = req.user.role === 'manager';

    let sql = `
      SELECT sr.*,
        ru.name as requester_name,
        su.name as successor_name,
        os.shift_date as original_date,
        os.start_time as original_start,
        os.end_time as original_end
      FROM swap_requests sr
      JOIN users ru ON sr.requester_id = ru.id
      JOIN users su ON sr.successor_id = su.id
      JOIN shifts os ON sr.original_shift_id = os.id
      WHERE 1=1
    `;
    const params = [];

    if (!isManager) {
      sql += ' AND (sr.requester_id = ? OR sr.successor_id = ?)';
      params.push(userId, userId);
    }

    if (filter) {
      if (filter === 'pending_confirm') {
        sql += " AND sr.status = 'pending_confirm'";
      } else if (filter === 'pending_approve') {
        sql += " AND sr.status = 'pending_approve'";
      } else if (filter === 'approved') {
        sql += " AND sr.status = 'approved'";
      } else if (filter === 'rejected') {
        sql += " AND sr.status IN ('rejected', 'successor_rejected')";
      } else if (filter === 'withdrawn') {
        sql += " AND sr.status = 'withdrawn'";
      }
    }

    sql += ' ORDER BY sr.updated_at DESC, sr.id DESC LIMIT 100';
    const requests = db.prepare(sql).all(...params);

    res.render('swap/list', {
      requests,
      filter: filter || 'all',
      statusLabels,
      isManager,
      currentUserId: userId
    });
  } catch (err) {
    next(err);
  }
});

router.get('/api/staff-shifts/:userId', requireStaff, async (req, res, next) => {
  try {
    const db = await dbPromise;
    const userId = Number(req.params.userId);
    const user = db.prepare('SELECT * FROM users WHERE id = ? AND role = ?').get(userId, 'staff');
    if (!user) return res.status(404).json({ error: '员工不存在' });
    const shifts = getUserAvailableShifts(db, userId);
    res.json({ shifts });
  } catch (err) {
    next(err);
  }
});

router.get('/new', requireStaff, async (req, res, next) => {
  try {
    const db = await dbPromise;
    const myShifts = getUserAvailableShifts(db, req.user.id);
    const staffList = getAllStaff(db).filter(s => s.id !== req.user.id);

    const formData = {};
    const preShiftId = Number(req.query.shift_id || 0);
    if (preShiftId) {
      const preShift = myShifts.find(s => s.id === preShiftId);
      if (preShift) formData.original_shift_id = preShiftId;
    }

    res.render('swap/new', {
      myShifts,
      staffList,
      error: null,
      formData
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireStaff, async (req, res, next) => {
  try {
    const db = await dbPromise;
    const { original_shift_id, successor_id, new_shift_id, reason } = req.body;

    if (!original_shift_id || !successor_id || !reason || !reason.trim()) {
      const myShifts = getUserAvailableShifts(db, req.user.id);
      const staffList = getAllStaff(db).filter(s => s.id !== req.user.id);
      return res.status(400).render('swap/new', {
        myShifts, staffList,
        error: '请填写完整信息（原班次、接班人、原因不能为空）',
        formData: req.body
      });
    }

    const originalShift = getShiftById(db, original_shift_id);
    if (!originalShift || originalShift.user_id !== req.user.id || originalShift.status !== 'active') {
      const myShifts = getUserAvailableShifts(db, req.user.id);
      const staffList = getAllStaff(db).filter(s => s.id !== req.user.id);
      return res.status(400).render('swap/new', {
        myShifts, staffList,
        error: '原班次无效或不属于您',
        formData: req.body
      });
    }

    const successor = db.prepare('SELECT * FROM users WHERE id = ? AND role = ?').get(successor_id, 'staff');
    if (!successor) {
      const myShifts = getUserAvailableShifts(db, req.user.id);
      const staffList = getAllStaff(db).filter(s => s.id !== req.user.id);
      return res.status(400).render('swap/new', {
        myShifts, staffList,
        error: '接班人不存在或不是员工',
        formData: req.body
      });
    }

    const existingPending = db.prepare(`
      SELECT * FROM swap_requests
      WHERE original_shift_id = ? AND status IN ('pending_confirm', 'pending_approve')
    `).get(original_shift_id);
    if (existingPending) {
      const myShifts = getUserAvailableShifts(db, req.user.id);
      const staffList = getAllStaff(db).filter(s => s.id !== req.user.id);
      return res.status(400).render('swap/new', {
        myShifts, staffList,
        error: '该班次已有进行中的换班申请',
        formData: req.body
      });
    }

    let newShiftObj = null;
    if (new_shift_id && new_shift_id !== '') {
      newShiftObj = getShiftById(db, new_shift_id);
      if (!newShiftObj || newShiftObj.user_id !== Number(successor_id) || newShiftObj.status !== 'active') {
        const myShifts = getUserAvailableShifts(db, req.user.id);
        const staffList = getAllStaff(db).filter(s => s.id !== req.user.id);
        return res.status(400).render('swap/new', {
          myShifts, staffList,
          error: '新班次无效或不属于接班人',
          formData: req.body
        });
      }

      const overlapOnOriginal = checkShiftOverlap(
        db, successor_id, originalShift.shift_date,
        originalShift.start_time, originalShift.end_time,
        new_shift_id
      );
      if (overlapOnOriginal) {
        const myShifts = getUserAvailableShifts(db, req.user.id);
        const staffList = getAllStaff(db).filter(s => s.id !== req.user.id);
        return res.status(400).render('swap/new', {
          myShifts, staffList,
          error: `接班人在 ${originalShift.shift_date} 已有班次 ${overlapOnOriginal.start_time}-${overlapOnOriginal.end_time}，时间冲突`,
          formData: req.body
        });
      }

      const overlapOnNew = checkShiftOverlap(
        db, req.user.id, newShiftObj.shift_date,
        newShiftObj.start_time, newShiftObj.end_time,
        original_shift_id
      );
      if (overlapOnNew) {
        const myShifts = getUserAvailableShifts(db, req.user.id);
        const staffList = getAllStaff(db).filter(s => s.id !== req.user.id);
        return res.status(400).render('swap/new', {
          myShifts, staffList,
          error: `您在 ${newShiftObj.shift_date} 已有班次 ${overlapOnNew.start_time}-${overlapOnNew.end_time}，时间冲突`,
          formData: req.body
        });
      }
    } else {
      const overlapOnOriginal = checkShiftOverlap(
        db, successor_id, originalShift.shift_date,
        originalShift.start_time, originalShift.end_time
      );
      if (overlapOnOriginal) {
        const myShifts = getUserAvailableShifts(db, req.user.id);
        const staffList = getAllStaff(db).filter(s => s.id !== req.user.id);
        return res.status(400).render('swap/new', {
          myShifts, staffList,
          error: `接班人在 ${originalShift.shift_date} 已有班次 ${overlapOnOriginal.start_time}-${overlapOnOriginal.end_time}，时间冲突`,
          formData: req.body
        });
      }
    }

    const now = nowLocal();
    const insertReq = db.prepare(`
      INSERT INTO swap_requests
      (requester_id, successor_id, original_shift_id, new_shift_id, reason, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'pending_confirm', ?, ?)
    `);
    const result = insertReq.run(
      req.user.id, successor_id, original_shift_id,
      new_shift_id || null, reason.trim(), now, now
    );
    const requestId = result.lastInsertRowid;

    db.prepare(`
      INSERT INTO approval_timeline (swap_request_id, actor_id, action, comment, created_at)
      VALUES (?, ?, 'submit', ?, ?)
    `).run(requestId, req.user.id, reason.trim(), now);

    createNotification(
      db, successor_id, requestId, 'pending_confirm',
      `${req.user.name} 申请将 ${originalShift.shift_date} ${originalShift.start_time}-${originalShift.end_time} 的班次与您调换，请确认`,
      now
    );

    req.session.flash = { type: 'success', message: '换班申请已提交，等待接班人确认' };
    res.redirect(`/swap/${requestId}`);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const db = await dbPromise;
    const request = getSwapRequestById(db, req.params.id);
    if (!request) {
      return res.status(404).render('error', { message: '申请不存在' });
    }

    const isRequester = request.requester_id === req.user.id;
    const isSuccessor = request.successor_id === req.user.id;
    const isManager = req.user.role === 'manager';

    if (!isRequester && !isSuccessor && !isManager) {
      return res.status(403).render('error', { message: '无权限查看此申请' });
    }

    const timeline = getTimeline(db, request.id);
    res.render('swap/detail', {
      request,
      timeline,
      statusLabels,
      actionLabels,
      isRequester,
      isSuccessor,
      isManager
    });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/successor-confirm', async (req, res, next) => {
  try {
    const db = await dbPromise;
    const request = getSwapRequestById(db, req.params.id);
    if (!request) return res.status(404).render('error', { message: '申请不存在' });
    if (request.successor_id !== req.user.id) return res.status(403).render('error', { message: '无权限操作' });
    if (request.status !== 'pending_confirm') {
      req.session.flash = { type: 'error', message: '当前状态无法确认' };
      return res.redirect(`/swap/${request.id}`);
    }

    if (request.new_shift_id) {
      const originalShift = getShiftById(db, request.original_shift_id);
      const overlap1 = checkShiftOverlap(
        db, request.successor_id, originalShift.shift_date,
        originalShift.start_time, originalShift.end_time,
        request.new_shift_id
      );
      if (overlap1) {
        req.session.flash = { type: 'error', message: `检测到时间冲突：接班人在 ${originalShift.shift_date} 已有班次` };
        return res.redirect(`/swap/${request.id}`);
      }
      const newShift = getShiftById(db, request.new_shift_id);
      const overlap2 = checkShiftOverlap(
        db, request.requester_id, newShift.shift_date,
        newShift.start_time, newShift.end_time,
        request.original_shift_id
      );
      if (overlap2) {
        req.session.flash = { type: 'error', message: `检测到时间冲突：申请人在 ${newShift.shift_date} 已有班次` };
        return res.redirect(`/swap/${request.id}`);
      }
    } else {
      const originalShift = getShiftById(db, request.original_shift_id);
      const overlap = checkShiftOverlap(
        db, request.successor_id, originalShift.shift_date,
        originalShift.start_time, originalShift.end_time
      );
      if (overlap) {
        req.session.flash = { type: 'error', message: `检测到时间冲突：接班人在 ${originalShift.shift_date} 已有班次` };
        return res.redirect(`/swap/${request.id}`);
      }
    }

    const now = nowLocal();
    db.prepare(`
      UPDATE swap_requests
      SET status = 'pending_approve', updated_at = ?
      WHERE id = ?
    `).run(now, request.id);

    db.prepare(`
      INSERT INTO approval_timeline (swap_request_id, actor_id, action, comment, created_at)
      VALUES (?, ?, 'successor_confirm', ?, ?)
    `).run(request.id, req.user.id, req.body.comment || '确认接班', now);

    invalidateNotificationsForRequest(db, request.id, ['pending_confirm']);

    const managers = db.prepare("SELECT * FROM users WHERE role = 'manager'").all();
    const requestDetail = getSwapRequestById(db, request.id);
    for (const m of managers) {
      createNotification(
        db, m.id, request.id, 'pending_approve',
        `${requestDetail.requester_name} 申请与 ${requestDetail.successor_name} 换班（${requestDetail.original_date} ${requestDetail.original_start}-${requestDetail.original_end}），${req.user.name}已确认，请审批`,
        now
      );
    }

    req.session.flash = { type: 'success', message: '已确认接班，等待店长审批' };
    res.redirect(`/swap/${request.id}`);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/successor-reject', async (req, res, next) => {
  try {
    const db = await dbPromise;
    const request = getSwapRequestById(db, req.params.id);
    if (!request) return res.status(404).render('error', { message: '申请不存在' });
    if (request.successor_id !== req.user.id) return res.status(403).render('error', { message: '无权限操作' });
    if (request.status !== 'pending_confirm') {
      req.session.flash = { type: 'error', message: '当前状态无法拒绝' };
      return res.redirect(`/swap/${request.id}`);
    }

    const comment = (req.body.comment || '').trim();
    if (!comment) {
      req.session.flash = { type: 'error', message: '拒绝原因不能为空' };
      return res.redirect(`/swap/${request.id}`);
    }

    const now = nowLocal();
    db.prepare(`
      UPDATE swap_requests
      SET status = 'successor_rejected', reject_reason = ?, updated_at = ?
      WHERE id = ?
    `).run(comment, now, request.id);

    db.prepare(`
      INSERT INTO approval_timeline (swap_request_id, actor_id, action, comment, created_at)
      VALUES (?, ?, 'successor_reject', ?, ?)
    `).run(request.id, req.user.id, comment, now);

    invalidateNotificationsForRequest(db, request.id);

    const requestDetail = getSwapRequestById(db, request.id);
    createNotification(
      db, request.requester_id, request.id, 'successor_rejected',
      `${req.user.name} 拒绝了您的换班申请（${requestDetail.original_date} ${requestDetail.original_start}-${requestDetail.original_end}），原因：${comment}`,
      now
    );

    req.session.flash = { type: 'success', message: '已拒绝接班' };
    res.redirect(`/swap/${request.id}`);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/approve', requireManager, async (req, res, next) => {
  try {
    const db = await dbPromise;
    const request = getSwapRequestById(db, req.params.id);
    if (!request) return res.status(404).render('error', { message: '申请不存在' });
    if (request.status !== 'pending_approve') {
      req.session.flash = { type: 'error', message: '当前状态无法审批' };
      return res.redirect(`/swap/${request.id}`);
    }

    if (request.new_shift_id) {
      const originalShift = getShiftById(db, request.original_shift_id);
      const overlap1 = checkShiftOverlap(
        db, request.successor_id, originalShift.shift_date,
        originalShift.start_time, originalShift.end_time,
        request.new_shift_id
      );
      if (overlap1) {
        req.session.flash = { type: 'error', message: `审批时检测到冲突：接班人在 ${originalShift.shift_date} 已有班次` };
        return res.redirect(`/swap/${request.id}`);
      }
      const newShift = getShiftById(db, request.new_shift_id);
      const overlap2 = checkShiftOverlap(
        db, request.requester_id, newShift.shift_date,
        newShift.start_time, newShift.end_time,
        request.original_shift_id
      );
      if (overlap2) {
        req.session.flash = { type: 'error', message: `审批时检测到冲突：申请人在 ${newShift.shift_date} 已有班次` };
        return res.redirect(`/swap/${request.id}`);
      }
    } else {
      const originalShift = getShiftById(db, request.original_shift_id);
      const overlap = checkShiftOverlap(
        db, request.successor_id, originalShift.shift_date,
        originalShift.start_time, originalShift.end_time
      );
      if (overlap) {
        req.session.flash = { type: 'error', message: `审批时检测到冲突：接班人在 ${originalShift.shift_date} 已有班次` };
        return res.redirect(`/swap/${request.id}`);
      }
    }

    const now = nowLocal();
    if (request.new_shift_id) {
      db.prepare('UPDATE shifts SET user_id = ?, swap_request_id = ? WHERE id = ?').run(
        request.successor_id, request.id, request.original_shift_id
      );
      db.prepare('UPDATE shifts SET user_id = ?, swap_request_id = ? WHERE id = ?').run(
        request.requester_id, request.id, request.new_shift_id
      );
    } else {
      db.prepare('UPDATE shifts SET user_id = ?, swap_request_id = ?, status = ? WHERE id = ?').run(
        request.successor_id, request.id, 'active', request.original_shift_id
      );
    }

    db.prepare(`
      UPDATE swap_requests
      SET status = 'approved', updated_at = ?
      WHERE id = ?
    `).run(now, request.id);

    db.prepare(`
      INSERT INTO approval_timeline (swap_request_id, actor_id, action, comment, created_at)
      VALUES (?, ?, 'approve', ?, ?)
    `).run(request.id, req.user.id, req.body.comment || '批准换班', now);

    invalidateNotificationsForRequest(db, request.id);

    const requestDetail = getSwapRequestById(db, request.id);
    const approveMsg = `店长 ${req.user.name} 已批准 ${requestDetail.requester_name} 与 ${requestDetail.successor_name} 的换班申请（${requestDetail.original_date} ${requestDetail.original_start}-${requestDetail.original_end}）`;
    createNotification(db, request.requester_id, request.id, 'approved', approveMsg, now);
    createNotification(db, request.successor_id, request.id, 'approved', approveMsg, now);

    req.session.flash = { type: 'success', message: '已批准换班，班表已同步更新' };
    res.redirect(`/swap/${request.id}`);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/reject', requireManager, async (req, res, next) => {
  try {
    const db = await dbPromise;
    const request = getSwapRequestById(db, req.params.id);
    if (!request) return res.status(404).render('error', { message: '申请不存在' });
    if (request.status !== 'pending_approve') {
      req.session.flash = { type: 'error', message: '当前状态无法驳回' };
      return res.redirect(`/swap/${request.id}`);
    }

    const comment = (req.body.comment || '').trim();
    if (!comment) {
      req.session.flash = { type: 'error', message: '驳回原因不能为空' };
      return res.redirect(`/swap/${request.id}`);
    }

    const now = nowLocal();
    db.prepare(`
      UPDATE swap_requests
      SET status = 'rejected', reject_reason = ?, updated_at = ?
      WHERE id = ?
    `).run(comment, now, request.id);

    db.prepare(`
      INSERT INTO approval_timeline (swap_request_id, actor_id, action, comment, created_at)
      VALUES (?, ?, 'reject', ?, ?)
    `).run(request.id, req.user.id, comment, now);

    invalidateNotificationsForRequest(db, request.id);

    const requestDetail = getSwapRequestById(db, request.id);
    const rejectMsg = `店长 ${req.user.name} 驳回了 ${requestDetail.requester_name} 与 ${requestDetail.successor_name} 的换班申请（${requestDetail.original_date} ${requestDetail.original_start}-${requestDetail.original_end}），原因：${comment}`;
    createNotification(db, request.requester_id, request.id, 'rejected', rejectMsg, now);
    createNotification(db, request.successor_id, request.id, 'rejected', rejectMsg, now);

    req.session.flash = { type: 'success', message: '已驳回申请' };
    res.redirect(`/swap/${request.id}`);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/withdraw', async (req, res, next) => {
  try {
    const db = await dbPromise;
    const request = getSwapRequestById(db, req.params.id);
    if (!request) return res.status(404).render('error', { message: '申请不存在' });
    if (request.requester_id !== req.user.id) return res.status(403).render('error', { message: '无权限操作' });

    if (!['pending_confirm', 'pending_approve'].includes(request.status)) {
      req.session.flash = { type: 'error', message: '当前状态无法撤回' };
      return res.redirect(`/swap/${request.id}`);
    }

    const now = nowLocal();
    db.prepare(`
      UPDATE swap_requests
      SET status = 'withdrawn', updated_at = ?
      WHERE id = ?
    `).run(now, request.id);

    db.prepare(`
      INSERT INTO approval_timeline (swap_request_id, actor_id, action, comment, created_at)
      VALUES (?, ?, 'withdraw', ?, ?)
    `).run(request.id, req.user.id, req.body.comment || '申请人撤回', now);

    invalidateNotificationsForRequest(db, request.id);

    const requestDetail = getSwapRequestById(db, request.id);
    const withdrawMsg = `${req.user.name} 已撤回换班申请（${requestDetail.original_date} ${requestDetail.original_start}-${requestDetail.original_end}）`;
    createNotification(db, request.successor_id, request.id, 'withdrawn', withdrawMsg, now);
    const managers = db.prepare("SELECT * FROM users WHERE role = 'manager'").all();
    for (const m of managers) {
      createNotification(db, m.id, request.id, 'withdrawn', withdrawMsg, now);
    }

    req.session.flash = { type: 'success', message: '已撤回申请' };
    res.redirect(`/swap/${request.id}`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
