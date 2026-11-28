-- Wrong amounts and messages from buyers (2026-11-28).
ALTER TABLE orders ADD COLUMN seen TEXT;
ALTER TABLE orders ADD COLUMN help_sent INTEGER NOT NULL DEFAULT 0;
