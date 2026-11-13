-- Records which reminders and alert notifications were already sent, so the 15-minute cron never repeats one.
CREATE TABLE notifications_sent (
  key TEXT PRIMARY KEY,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
