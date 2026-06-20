const dbPromise = require('./db');
const { nowLocal } = require('./db');

async function seed() {
  const db = await dbPromise;

  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  if (userCount > 0) {
    console.log('数据库已有数据，跳过种子数据填充');
    return;
  }

  const insertUser = db.prepare(
    'INSERT INTO users (username, password, name, role) VALUES (?, ?, ?, ?)'
  );
  const insertShift = db.prepare(
    'INSERT INTO shifts (user_id, shift_date, start_time, end_time, status) VALUES (?, ?, ?, ?, ?)'
  );

  const managerId = insertUser.run('manager', '123456', '张店长', 'manager').lastInsertRowid;
  const staff1Id = insertUser.run('staff1', '123456', '李小明', 'staff').lastInsertRowid;
  const staff2Id = insertUser.run('staff2', '123456', '王小红', 'staff').lastInsertRowid;
  const staff3Id = insertUser.run('staff3', '123456', '赵小强', 'staff').lastInsertRowid;

  const today = new Date();
  const formatDate = (d) => d.toISOString().split('T')[0];
  const addDays = (d, n) => {
    const nd = new Date(d);
    nd.setDate(nd.getDate() + n);
    return formatDate(nd);
  };

  const shifts = [
    { user_id: staff1Id, shift_date: addDays(today, 1), start_time: '09:00', end_time: '17:00' },
    { user_id: staff1Id, shift_date: addDays(today, 2), start_time: '14:00', end_time: '22:00' },
    { user_id: staff1Id, shift_date: addDays(today, 3), start_time: '09:00', end_time: '17:00' },
    { user_id: staff1Id, shift_date: addDays(today, 4), start_time: '09:00', end_time: '17:00' },

    { user_id: staff2Id, shift_date: addDays(today, 1), start_time: '14:00', end_time: '22:00' },
    { user_id: staff2Id, shift_date: addDays(today, 2), start_time: '09:00', end_time: '17:00' },
    { user_id: staff2Id, shift_date: addDays(today, 3), start_time: '14:00', end_time: '22:00' },
    { user_id: staff2Id, shift_date: addDays(today, 5), start_time: '09:00', end_time: '17:00' },

    { user_id: staff3Id, shift_date: addDays(today, 1), start_time: '09:00', end_time: '17:00' },
    { user_id: staff3Id, shift_date: addDays(today, 4), start_time: '14:00', end_time: '22:00' },
    { user_id: staff3Id, shift_date: addDays(today, 5), start_time: '14:00', end_time: '22:00' },
    { user_id: staff3Id, shift_date: addDays(today, 6), start_time: '09:00', end_time: '17:00' },

    { user_id: managerId, shift_date: addDays(today, 2), start_time: '09:00', end_time: '18:00' },
    { user_id: managerId, shift_date: addDays(today, 5), start_time: '09:00', end_time: '18:00' },
  ];

  shifts.forEach(s => insertShift.run(s.user_id, s.shift_date, s.start_time, s.end_time, 'active'));

  console.log('种子数据填充完成');
  console.log('测试账号:');
  console.log('  店长: manager / 123456');
  console.log('  员工: staff1 / 123456  (李小明)');
  console.log('  员工: staff2 / 123456  (王小红)');
  console.log('  员工: staff3 / 123456  (赵小强)');
}

seed().catch(console.error);
