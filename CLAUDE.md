# PYQ Brain

Personal exam-prep app for a B.Pharm Sem 5 (PCI) student. Upload previous-year question papers → AI OCR + split + tag (subject/unit/topic/marks) → group repeats → priority table → exam answers written only from the student's own Noteskart notes (P1a).

Subjects: BP501T Medicinal Chem II, BP502T Industrial Pharmacy I, BP503T Pharmacology II, BP504T Pharmacognosy & Phytochem II, BP505T Pharma Jurisprudence. 5 units each. Syllabus lives in `data/syllabus.json` (bundled at build), filled verbatim from the PCI B.Pharm syllabus (user's university follows PCI). Unit titles = that unit's headings joined by "; "; topics = headings/sub-items, prefixed "Parent: " only where needed for uniqueness; optional `text` = verbatim unit content for AI context. Never invent syllabus content.

## Stack
- One Cloudflare Worker, Hono + Hono JSX SSR, htmx (vendored `public/htmx.min.js`). No React/Vite/Tailwind/front-end build.
- Static files in `public/` served by Workers Assets (bypass Worker; no auth on them).
- D1 (`DB`) for data, R2 (`BUCKET`) for page JPEGs at `u/{user}/{paper}/{n}.jpg`.
- AI: provider-agnostic (`src/ai.ts`): Gemini (`responseJsonSchema`), OpenAI-compatible (`json_schema`, custom base URL), Anthropic (forced tool call). zod validation, retry once. Provider/model/key chosen on the Settings page.
- NO secrets in env/wrangler. Passcode (salted SHA-256), session secret, AI key live in D1 `settings` (user_id `_app` = app-wide, `me` = per-user). First run → `/setup` sets passcode. `/settings` edits all.
- Deps: hono, zod (runtime). pdf.js lazy-loaded from jsDelivr only when a PDF is chosen. Dev: wrangler, typescript, workers-types, vitest, htmx.org (source of vendored file).

## Files
- `src/index.tsx` routes, auth, D1 queries, regroup
- `src/views.tsx` all JSX pages/fragments
- `src/ai.ts` providers, prompts, JSON schemas, zod, syllabus normalisation, grouping sanitiser
- `src/priority.ts` priority formula (documented there) + group aggregation
- `public/sw.js` offline: static assets cache + background refresh; `/priority/:code` (answers are inline there) network-first, synced for all subjects on page load (10 min throttle, reset by any non-GET). `/logout` sends Clear-Site-Data.
- `public/app.css` design system (tokens → components); `DESIGN.md` documents it; `/design` = live specimen. `scripts/ink.mjs` generates the hand-drawn outline tokens (`npm run ink`). Fonts: `public/fonts/` Kevin Sans (MIT).
- `public/shell.js` sidebar pin/drawer + Samjhao "Suno" read-aloud (Web Speech API; voices ranked Natural/Neural/Online/Google first, en-IN > hi-IN > en; voice picker remembered in localStorage `pyq-voice`; chunked; buttons hidden where unsupported)
- `public/upload.js` client resize (1600px, JPEG 0.7), PDF render, one-page-per-request loop, retry failed pages
- Answer figures: `[[fig:slug]]` in answer text → `Fig` (views.tsx) shows `public/fig/<slug>.svg` + caption + link to `/notes-page/:code/:unit/:page` (original notes page JPEG in private R2 `notes/{code}/U{unit}/p{page}.jpg`, behind login). Manifest `data/figures.json`; `scripts/figures.py` (RDKit, dev venv only) draws structures/schemes from PubChem SMILES, each formula-checked; reaction conditions come from the notes; kind `svg` = hand-drawn diagram. Never trace structures from the notes (they contain drawing errors). sw.js caches figures offline.
- `scripts/notes_ocr.py` one-time local OCR (poppler + tesseract, `.tessdata/eng.traineddata`) of scanned `noteskart/<folder>/UNIT-n*.pdf` → `data/notes.sql`. Folder→subject map inside the script.
- `migrations/` D1 schema. `test/` vitest.

## Hard constraints (free tier)
- D1 free: 5M rows READ per day (reset 00:00 UTC). Exceeded once (2026-11-14) → whole site 500 until reset. Every per-group/per-row subquery must hit an index (`idx_questions_group`, migration 0004); check with EXPLAIN QUERY PLAN (no "SCAN questions"). Bulk AI runs + SW sync multiply reads.
- Worker 10 ms CPU/request, 50 subrequests. D1 free: 50 queries/invocation → bulk writes use one `INSERT … SELECT FROM json_each(?)`, never per-row statements.
- No PDF/image processing in the Worker. One page per request.
- < 30 KB JS on normal pages (currently htmx 16.8 KB gz + upload.js 2 KB gz). Visuals are CSS only (app.css ~8 KB gz) + Kevin Sans 2×45 KB woff2 (cached offline by sw.js).
- AI key server-only: stored in D1, shown masked (last 4), never sent to browser.
- Security (repo is public): `/login` limited to 5 wrong tries per IP (IPv6 /64) and 30 overall per 15 min, counters in `settings` user_id `_login`. Passcode change rotates the session secret (other devices logged out). Every Worker response gets X-Frame-Options/CSP/nosniff/HSTS; static files get theirs from `public/_headers`. CSP `script-src` = 'self' + pdf.js jsDelivr path (version must match `upload.js`, test checks) + sha256 of each inline script: any new inline `<script>` must be added to `INLINE_SCRIPTS` (views.tsx), no inline `on*=` handlers (test checks). Session cookie is `__Host-pyq_session` (Hono `prefix: 'host'`). A saved AI key only goes to the host it was entered for (`aiHost`): changing provider/Base URL requires re-entering the key. Referrer-Policy must stay `same-origin` (`no-referrer` makes browsers send `Origin: null` → csrf() 403 on every form). `csvCell` neutralises `= + - @` cells. Never commit notes or answers (`data/*.sql` git-ignored) or the live URL.

## Conventions
- `user_id` on every table; currently always `'me'` from the signed cookie. Multi-user = replace auth block in index.tsx; AI settings already per-user.
- Unit/topic must be in syllabus; otherwise null + confidence ≤ 0.3 (`normalizeToSyllabus`). Low confidence (< 0.6 or unit null) is highlighted in Review.
- User edits set `edited=1, confidence=1`; group stats refresh without AI (`refreshGroup`). Full "Regroup" rebuilds groups for a subject via one AI call; the model returns only repeat groups (2+), the rest become singletons. If the AI fails, every question is shown ungrouped (never hidden).
- AI calls: `max_tokens` 8192, 90 s timeout per attempt, OpenRouter gets `reasoning: {enabled:false}` (reasoning models otherwise burn the whole budget and return empty content).
- Priority page: questions are `<details>`; tap opens saved answer inline (no separate answer page; `POST /answer/:id` swaps `.ab`). Unit coverage collapsed. Print view = all open. Unit/marks filter chips (`Filters`) pure CSS (radio + `:has()`); marks filter matches **every** marks value a group was asked for (`all_marks`, derived in `loadGroups` from the wordings already loaded — no extra D1 read), `data-m="2 7"` + `[data-m~="N"]`, badge "2 / 7 marks". A topic asked as a 2-marker one year and a 10-marker another belongs to both filters; using `max_marks` alone hid 38% of 2-markers. Flashcards = any group ever asked as a 2-marker.
- Papers list lives in Settings (collapsed). Delete = tick + passcode (`POST /papers/delete`, checked server-side).
- Answers (P1a): `notes` is an FTS5 table (one row per OCR'd page). `/answer/:groupId` searches it with bm25 (`notesQuery` drops exam verbs, quotes terms; own unit ×1.3), sends top 5 pages, model must answer ONLY from them, cite `[U1 p3]`, mark "Not in notes", length by marks (`answerLength`). Saved in `answers` keyed by the group's MIN(question id) so answers survive Regroup. Rendered via `Md` (tiny markdown subset, escaped): `## h`, bullets, `**bold**`, `*italic*`, `[[fig:slug]]`, plus two answer-only markers — a line starting `✎` = fact-check correction (`p.fix`, red pencil), and a line starting `⚑` opens a textbook section that runs to the end of the answer (`section.ext`, blue box) for parts the notes do not cover; the answer banner then says "textbook answer added". Every ✎/⚑ block names its source. No tables.
- Samjhao (P2): table `samjhao` (migration 0005), same key as answers (group MIN question id), JOINed in `loadGroups` (materialized CTE so the MIN subquery runs once). Shown as closed `details.sj` above the answer (`Samjhao` in views.tsx, noprint). Hinglish, Roman script, written by Claude from the saved answers/notes (no app-AI button); lines starting `💡` = memory trick (`.yaad` yellow sticky), `🏠` = real-life example (`.eg` blue sticky); points beyond the notes tagged "(textbook)". All 271 groups done 2026-11-15 (`data/pending/samjhao_top15_2026-11-15.sql` + `samjhao_rest_2026-11-15.sql`); a group created later by Regroup has no Samjhao until written.
- Noteskart notes are the student's own copies for personal study: never scrape the Noteskart site; notes text stays in the student's D1 only.
- UI: follow DESIGN.md (paper & pen, after Looseleaf). Role tokens only, no raw hex; buttons: `.primary` once per screen, `.secondary`, `.ghost`, `.danger`.
- Keep it simple: few files, no new abstractions/deps without justification.

## Local dev note
Local D1 file is keyed by `database_id`; the live (remote) D1 named in `wrangler.jsonc` is the source of truth now. Live URL is kept out of the repo on purpose (public repo; bots would burn D1 free reads).

## Commands
`npm test`, `npm run typecheck`, `npm run dev`, `npm run db:migrate:local|remote`, `npm run deploy`, `npm run notes:ocr` then `npm run notes:import:local|remote`.

## Roadmap (not built)
- P1a answers from notes: BUILT. Inline answers + offline + print-with-answers: BUILT.
- P1b: textbook answers with citations (Cloudflare AI Search over textbook PDFs in R2).
- P2 Samjhao: BUILT (Hinglish, TTS, figures, memory tricks, real-life examples) for every group (271). Hindi/English versions not planned (user chose Hinglish only).
- P3: flashcards, animated explainer videos, multi-user.
