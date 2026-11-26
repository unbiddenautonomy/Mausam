-- Notifications paused at the owner's request (26 Nov 2026), until they turn them back on in Settings.
INSERT INTO settings (key, value) VALUES ('notifications_paused', '1') ON CONFLICT (key) DO UPDATE SET value = '1';
