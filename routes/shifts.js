const express = require('express');
const dbPromise = require('../db');
const router = express.Router();
const { formatDate } = require('../utils');

router.get('/', async (req, res, next) => {
  try {
    const db = await dbPromise;
    const { date } = req.query;
    const today = new Date();

    let viewStart;
    if (date) {
      viewStart = new Date(date);
    } else {
      viewStart = new Date(today);
      const day = viewStart.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      viewStart.setDate(viewStart.getDate() + diff);
    }

    const dates = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(viewStart);
      d.setDate(d.getDate() + i);
      dates.push(formatDate(d));
    }

    const users = db.prepare("SELECT * FROM users ORDER BY role DESC, name ASC").all();

    const shifts = db.prepare(`
      SELECT s.*, u.name as user_name, u.role as user_role,
        sr.status as swap_status, sr.id as swap_id
      FROM shifts s
      JOIN users u ON s.user_id = u.id
      LEFT JOIN swap_requests sr ON (sr.original_shift_id = s.id OR sr.new_shift_id = s.id)
        AND sr.status IN ('pending_confirm', 'pending_approve', 'approved')
      WHERE s.shift_date IN (?, ?, ?, ?, ?, ?, ?)
      ORDER BY s.shift_date ASC, s.start_time ASC
    `).all(...dates);

    const approvedSwaps = db.prepare(`
      SELECT sr.*,
        ru.name as requester_name,
        su.name as successor_name,
        os.shift_date as original_date,
        os.start_time as original_start,
        os.end_time as original_end,
        ns.shift_date as new_date,
        ns.start_time as new_start,
        ns.end_time as new_end
      FROM swap_requests sr
      JOIN users ru ON sr.requester_id = ru.id
      JOIN users su ON sr.successor_id = su.id
      JOIN shifts os ON sr.original_shift_id = os.id
      LEFT JOIN shifts ns ON sr.new_shift_id = ns.id
      WHERE sr.status = 'approved' AND (os.shift_date IN (?, ?, ?, ?, ?, ?, ?) OR ns.shift_date IN (?, ?, ?, ?, ?, ?, ?))
    `).all(...dates, ...dates);

    const shiftMap = {};
    for (const d of dates) shiftMap[d] = {};
    for (const u of users) {
      for (const d of dates) shiftMap[d][u.id] = [];
    }
    for (const s of shifts) {
      if (shiftMap[s.shift_date] && shiftMap[s.shift_date][s.user_id]) {
        shiftMap[s.shift_date][s.user_id].push(s);
      }
    }

    const weekStart = dates[0];
    const weekEnd = dates[6];
    const prevWeek = new Date(viewStart);
    prevWeek.setDate(prevWeek.getDate() - 7);
    const nextWeek = new Date(viewStart);
    nextWeek.setDate(nextWeek.getDate() + 7);

    res.render('shifts/index', {
      users,
      dates,
      shiftMap,
      approvedSwaps,
      weekStart,
      weekEnd,
      prevWeek: formatDate(prevWeek),
      nextWeek: formatDate(nextWeek)
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
