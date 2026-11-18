-- P2 "Samjhao": a simple Hinglish explanation per question group, written once (by Claude, from the notes)
-- and shown under the exam answer. Keyed like answers by the group's smallest question id, so it survives Regroup.
-- Text uses the answer markdown subset plus two markers: "💡" memory trick, "🏠" real-life example.
CREATE TABLE samjhao (
  user_id      TEXT NOT NULL,
  question_id  INTEGER NOT NULL,
  subject_code TEXT NOT NULL,
  text         TEXT NOT NULL,
  model        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, question_id)
);
