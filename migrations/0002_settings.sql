-- App + per-user settings, editable from the Settings page (no secrets in code/env).
-- user_id '_app' = app-wide (passcode hash/salt, session secret). Other user_id = per-user (AI provider/model/key).
CREATE TABLE settings (
  user_id    TEXT NOT NULL,
  k          TEXT NOT NULL,
  v          TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, k)
);
