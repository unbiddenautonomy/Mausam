-- Two or more POS screens share their running orders through the server, and share one token counter.
-- Each screen keeps working offline and catches up when it's back online.

CREATE TABLE pos_open_orders (
  id TEXT PRIMARY KEY,              -- the order's id on the POS (later the bill's client_id)
  data TEXT NOT NULL,               -- the order as the POS keeps it (JSON); '{}' once closed
  updated_at TEXT NOT NULL,         -- when a screen last changed it (ISO time); the newest change wins
  closed INTEGER NOT NULL DEFAULT 0,  -- 1 once paid, cancelled or dropped on any screen
  counter TEXT,                     -- the screen that sent the last change
  seq INTEGER NOT NULL,             -- increases with every saved change, so a screen asks only for what's new
  saved_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_pos_open_orders_seq ON pos_open_orders(seq);
CREATE INDEX idx_pos_open_orders_closed ON pos_open_orders(closed, saved_at);

-- The last token number handed out. Tokens keep counting up and never restart.
INSERT INTO settings (key, value) VALUES ('pos_token_last', '0') ON CONFLICT (key) DO NOTHING;
