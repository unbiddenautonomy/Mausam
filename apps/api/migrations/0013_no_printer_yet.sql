-- No receipt printer at the counter yet: switch printing off so Save & Print saves the order and clears the screen
-- (no print pop-up). Orders are saved the same way as with a printer, so reports stay the same. When the printer
-- arrives, switch "A receipt printer is connected" on in Manage -> POS options; this runs only once and won't undo that.
INSERT INTO settings (key, value) VALUES ('pos_printing', '0')
ON CONFLICT (key) DO UPDATE SET value = excluded.value;
