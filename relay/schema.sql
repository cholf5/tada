-- 全局同步序号：每个改动拿一个递增的 seq，客户端靠 since 游标增量拉取
CREATE TABLE IF NOT EXISTS sync_seq (
  id    INTEGER PRIMARY KEY CHECK (id = 1),
  value INTEGER NOT NULL
);
INSERT OR IGNORE INTO sync_seq (id, value) VALUES (1, 0);

-- 设备：只存 token 的 SHA-256，原文只有客户端持有
CREATE TABLE IF NOT EXISTS devices (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT,
  revoked_at   TEXT
);

-- 一次性配对码：10 位十六进制（40 bit），10 分钟过期，用一次作废
CREATE TABLE IF NOT EXISTS pairing_codes (
  code       TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  -- 本次消费的唯一 claim：同一毫秒内的重放不会命中 INSERT
  claim_id   TEXT
);

-- 业务表：显式列，服务端认识自己的 schema
CREATE TABLE IF NOT EXISTS lists (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  color      TEXT,
  order_key  TEXT NOT NULL,
  hlc        TEXT NOT NULL,
  seq        INTEGER NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lists_seq ON lists (seq);

CREATE TABLE IF NOT EXISTS tasks (
  id         TEXT PRIMARY KEY,
  list_id    TEXT NOT NULL,
  parent_id  TEXT,
  title      TEXT NOT NULL,
  notes      TEXT,
  done       INTEGER NOT NULL DEFAULT 0,
  done_at    TEXT,
  due_at     TEXT,
  order_key  TEXT NOT NULL,
  hlc        TEXT NOT NULL,
  seq        INTEGER NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_seq  ON tasks (seq);
CREATE INDEX IF NOT EXISTS idx_tasks_list ON tasks (list_id);
