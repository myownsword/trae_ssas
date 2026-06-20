const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'ssas.db');

let dbInstance = null;
let SQL = null;

function nowLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function saveToDisk() {
  if (!dbInstance) return;
  const data = dbInstance.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

function createWrapper(db) {
  return {
    _raw: db,
    prepare(sql) {
      return {
        run(...params) {
          const stmt = db.prepare(sql);
          try {
            stmt.bind(params);
            stmt.step();
          } finally {
            stmt.free();
          }
          const infoStmt = db.prepare('SELECT last_insert_rowid() AS id, changes() AS c');
          let info;
          try {
            infoStmt.step();
            info = infoStmt.getAsObject();
          } finally {
            infoStmt.free();
          }
          saveToDisk();
          return { lastInsertRowid: info.id, changes: info.c };
        },
        get(...params) {
          const stmt = db.prepare(sql);
          let result = undefined;
          try {
            stmt.bind(params);
            if (stmt.step()) {
              result = stmt.getAsObject();
            }
          } finally {
            stmt.free();
          }
          return result;
        },
        all(...params) {
          const stmt = db.prepare(sql);
          const rows = [];
          try {
            stmt.bind(params);
            while (stmt.step()) {
              rows.push(stmt.getAsObject());
            }
          } finally {
            stmt.free();
          }
          return rows;
        }
      };
    },
    exec(sql) {
      db.exec(sql);
      saveToDisk();
    },
    pragma() {}
  };
}

async function initDb() {
  if (dbInstance) return createWrapper(dbInstance);

  SQL = await initSqlJs({
    locateFile: file => path.join(__dirname, 'node_modules', 'sql.js', 'dist', file)
  });

  let db;
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
    console.log('数据库已从磁盘加载');
  } else {
    db = new SQL.Database();
    console.log('创建新数据库');
  }

  dbInstance = db;

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('staff', 'manager'))
    );

    CREATE TABLE IF NOT EXISTS shifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      shift_date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'swapped', 'cancelled')),
      swap_request_id INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS swap_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requester_id INTEGER NOT NULL,
      successor_id INTEGER NOT NULL,
      original_shift_id INTEGER NOT NULL,
      new_shift_id INTEGER,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_confirm' CHECK (status IN (
        'pending_confirm', 'pending_approve', 'approved', 'rejected', 'withdrawn', 'successor_rejected'
      )),
      reject_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (requester_id) REFERENCES users(id),
      FOREIGN KEY (successor_id) REFERENCES users(id),
      FOREIGN KEY (original_shift_id) REFERENCES shifts(id),
      FOREIGN KEY (new_shift_id) REFERENCES shifts(id)
    );

    CREATE TABLE IF NOT EXISTS approval_timeline (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      swap_request_id INTEGER NOT NULL,
      actor_id INTEGER NOT NULL,
      action TEXT NOT NULL CHECK (action IN (
        'submit', 'successor_confirm', 'successor_reject',
        'approve', 'reject', 'withdraw'
      )),
      comment TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (swap_request_id) REFERENCES swap_requests(id),
      FOREIGN KEY (actor_id) REFERENCES users(id)
    );
  `);

  saveToDisk();
  console.log('数据库初始化完成');
  return createWrapper(db);
}

module.exports = initDb();
module.exports.nowLocal = nowLocal;
