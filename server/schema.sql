-- One row per top-up code. Times are milliseconds of speech.
CREATE TABLE IF NOT EXISTS codes (
  code TEXT PRIMARY KEY,            -- MF-XXXX-XXXX
  note TEXT NOT NULL DEFAULT '',    -- who it's for
  balance_ms INTEGER NOT NULL DEFAULT 0,
  used_ms INTEGER NOT NULL DEFAULT 0,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

-- Every top-up and every charge. Never holds what people said.
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,               -- topup | live | batch | text
  ms INTEGER NOT NULL               -- + added, - used
);
CREATE INDEX IF NOT EXISTS ledger_code ON ledger (code, id);
