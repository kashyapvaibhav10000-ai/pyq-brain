-- Reference notes (OCR text, one row per page) searchable with FTS5 bm25. Filled by scripts/notes_ocr.py.
CREATE VIRTUAL TABLE notes USING fts5(
  user_id UNINDEXED,
  subject_code UNINDEXED,
  unit UNINDEXED,
  page_no UNINDEXED,
  source UNINDEXED,
  text,
  tokenize = 'porter unicode61'
);

-- One saved answer per question group. Keyed by the group's smallest question id (not group id),
-- because Regroup rebuilds groups with new ids; the representative question usually survives.
CREATE TABLE answers (
  user_id      TEXT NOT NULL,
  question_id  INTEGER NOT NULL,
  subject_code TEXT NOT NULL,
  marks        INTEGER,
  covered      TEXT NOT NULL,          -- full | partial | none (how much the notes covered)
  text         TEXT NOT NULL,          -- markdown subset: "## ", "- ", **bold**
  sources_json TEXT NOT NULL DEFAULT '[]', -- [{unit, page}] pages given to the model
  model        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, question_id)
);
