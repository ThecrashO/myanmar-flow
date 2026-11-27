-- Screenshots pay on their own; doubtful ones wait for the owner on Telegram.
ALTER TABLE orders ADD COLUMN doubts TEXT;
ALTER TABLE orders ADD COLUMN paid_by TEXT;
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
