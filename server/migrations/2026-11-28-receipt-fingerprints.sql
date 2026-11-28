CREATE TABLE IF NOT EXISTS receipt_fingerprints (
  digest TEXT PRIMARY KEY,
  order_id TEXT NOT NULL
);
