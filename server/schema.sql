-- One row per top-up code. Times are milliseconds of speech.
CREATE TABLE IF NOT EXISTS codes (
  code TEXT PRIMARY KEY,            -- MF-XXXX-XXXX
  note TEXT NOT NULL DEFAULT '',    -- who it's for
  balance_ms INTEGER NOT NULL DEFAULT 0,
  used_ms INTEGER NOT NULL DEFAULT 0,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  expires_at TEXT                   -- NULL: never (codes from before expiry existed)
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

-- The shop (src/shop.js): orders, the owner's phone's wallet notifications, free trials.
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,              -- random, also the buyer's link to the order
  minutes INTEGER NOT NULL,
  amount INTEGER NOT NULL,          -- Ks to pay, unique among unpaid orders
  topup TEXT,                       -- code to top up, or NULL for a new code
  code TEXT,                        -- the code given, once paid
  status TEXT NOT NULL,             -- new | review (owner checks) | paid | rejected | revoked
  reason TEXT,                      -- what the buyer is told, in Burmese
  doubts TEXT,                      -- why the owner was asked to check, in Burmese
  seen TEXT,                        -- JSON {amount, txn, wallet} of a receipt with the wrong amount
  help_sent INTEGER NOT NULL DEFAULT 0, -- messages the buyer sent the owner from the order page
  txn TEXT,                         -- transaction ID read from the screenshot
  wallet TEXT,
  shot_tries INTEGER NOT NULL DEFAULT 0,
  net TEXT,                         -- hashed network, for rate limits
  name TEXT,                        -- the buyer, so they can get a lost code back
  email TEXT,
  payment_id INTEGER,               -- payments row that paid it (negative: no notification)
  paid_by TEXT,                     -- ai (screenshot alone) | owner | phone
  created_at TEXT NOT NULL,
  paid_at TEXT
);
CREATE INDEX IF NOT EXISTS orders_open ON orders (status, amount);
CREATE INDEX IF NOT EXISTS orders_txn ON orders (txn);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  wallet TEXT,
  amount INTEGER,                   -- NULL when the notification wasn't money received
  txn TEXT,
  sender TEXT,
  raw TEXT NOT NULL,                -- the notification text
  parsed INTEGER NOT NULL DEFAULT 0,
  order_id TEXT
);
CREATE INDEX IF NOT EXISTS payments_amount ON payments (amount, order_id);

CREATE TABLE IF NOT EXISTS trials (
  device TEXT PRIMARY KEY,          -- hashed device ID
  net TEXT,
  code TEXT NOT NULL,
  at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recoveries (
  net TEXT NOT NULL,                -- hashed network, to limit lost-code lookups
  at TEXT NOT NULL
);

-- Small server settings, e.g. the owner's Telegram chat.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
