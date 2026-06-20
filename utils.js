function timesOverlap(start1, end1, start2, end2) {
  const toMin = (t) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const s1 = toMin(start1), e1 = toMin(end1);
  const s2 = toMin(start2), e2 = toMin(end2);
  return s1 < e2 && s2 < e1;
}

function checkShiftOverlap(db, userId, shiftDate, startTime, endTime, excludeShiftId = null) {
  let sql = `
    SELECT s.*, u.name as user_name
    FROM shifts s
    JOIN users u ON s.user_id = u.id
    WHERE s.user_id = ? AND s.shift_date = ? AND s.status = 'active'
  `;
  const params = [userId, shiftDate];
  if (excludeShiftId) {
    sql += ' AND s.id != ?';
    params.push(excludeShiftId);
  }
  const existing = db.prepare(sql).all(...params);
  for (const shift of existing) {
    if (timesOverlap(startTime, endTime, shift.start_time, shift.end_time)) {
      return shift;
    }
  }
  return null;
}

function getUserAvailableShifts(db, userId, excludeShiftId = null) {
  let sql = `
    SELECT s.* FROM shifts s
    WHERE s.user_id = ? AND s.status = 'active'
  `;
  const params = [userId];
  if (excludeShiftId) {
    sql += ' AND s.id != ?';
    params.push(excludeShiftId);
  }
  sql += ' ORDER BY s.shift_date ASC, s.start_time ASC';
  return db.prepare(sql).all(...params);
}

function getUserById(db, id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function getAllStaff(db) {
  return db.prepare("SELECT * FROM users WHERE role = 'staff' ORDER BY name ASC").all();
}

function getShiftById(db, id) {
  return db.prepare(`
    SELECT s.*, u.name as user_name
    FROM shifts s JOIN users u ON s.user_id = u.id
    WHERE s.id = ?
  `).get(id);
}

function getSwapRequestById(db, id) {
  return db.prepare(`
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
    WHERE sr.id = ?
  `).get(id);
}

function getTimeline(db, requestId) {
  return db.prepare(`
    SELECT t.*, u.name as actor_name
    FROM approval_timeline t
    JOIN users u ON t.actor_id = u.id
    WHERE t.swap_request_id = ?
    ORDER BY t.created_at ASC, t.id ASC
  `).all(requestId);
}

const actionLabels = {
  submit: '提交申请',
  successor_confirm: '接班人确认',
  successor_reject: '接班人拒绝',
  approve: '店长批准',
  reject: '店长驳回',
  withdraw: '申请人撤回'
};

const statusLabels = {
  pending_confirm: '待接班人确认',
  pending_approve: '待店长审批',
  approved: '已通过',
  rejected: '已驳回',
  withdrawn: '已撤回',
  successor_rejected: '接班人已拒绝'
};

function startOfWeek(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfWeek(d) {
  const s = startOfWeek(d);
  s.setDate(s.getDate() + 6);
  s.setHours(23, 59, 59, 999);
  return s;
}

function formatDate(d) {
  return d.toISOString().split('T')[0];
}

module.exports = {
  timesOverlap,
  checkShiftOverlap,
  getUserAvailableShifts,
  getUserById,
  getAllStaff,
  getShiftById,
  getSwapRequestById,
  getTimeline,
  actionLabels,
  statusLabels,
  startOfWeek,
  endOfWeek,
  formatDate
};
