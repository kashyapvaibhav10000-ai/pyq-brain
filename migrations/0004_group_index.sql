-- Priority/answer queries look up "questions of group X" (MIN(id), members, wordings) once per group.
-- Without this index each lookup scanned the whole questions table, which used up D1's free
-- 5M rows/day read budget (2026-11-14). With it, each lookup reads only that group's rows.
CREATE INDEX IF NOT EXISTS idx_questions_group ON questions(group_id);
