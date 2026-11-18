-- PYQ Brain P0 schema. user_id on every table for future multi-user.
CREATE TABLE papers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       TEXT NOT NULL,
  subject_code  TEXT NOT NULL,
  year          INTEGER NOT NULL,
  exam_session  TEXT NOT NULL,          -- e.g. "Nov-Dec", "May-Jun"
  r2_key        TEXT NOT NULL,          -- prefix; pages stored at {r2_key}{n}.jpg
  page_count    INTEGER NOT NULL DEFAULT 0,
  pages_ok      TEXT NOT NULL DEFAULT '[]', -- JSON array of page numbers processed OK
  status        TEXT NOT NULL DEFAULT 'uploading', -- uploading | done | error
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_papers_user_subject ON papers(user_id, subject_code);

CREATE TABLE questions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       TEXT NOT NULL,
  paper_id      INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  subject_code  TEXT NOT NULL,
  year          INTEGER NOT NULL,       -- denormalized from papers for scoring
  page_no       INTEGER NOT NULL,
  raw_text      TEXT NOT NULL,          -- as OCR'd by Gemini
  clean_text    TEXT NOT NULL,          -- user-editable
  marks         INTEGER,
  unit          INTEGER CHECK (unit BETWEEN 1 AND 5),
  topic         TEXT,
  confidence    REAL NOT NULL DEFAULT 0,
  edited        INTEGER NOT NULL DEFAULT 0, -- 1 = user fixed tags; regroup never overwrites
  group_id      INTEGER REFERENCES question_groups(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_questions_user_subject ON questions(user_id, subject_code);
CREATE INDEX idx_questions_paper ON questions(paper_id);

CREATE TABLE question_groups (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          TEXT NOT NULL,
  subject_code     TEXT NOT NULL,
  unit             INTEGER,
  topic            TEXT,
  canonical_text   TEXT NOT NULL,
  occurrence_count INTEGER NOT NULL,
  years_json       TEXT NOT NULL,       -- JSON array of distinct years, sorted
  max_marks        INTEGER,
  priority_score   REAL NOT NULL,
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_groups_user_subject ON question_groups(user_id, subject_code);
