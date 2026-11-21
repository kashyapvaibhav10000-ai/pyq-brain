import { Hono } from 'hono';
import type { Context } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';
import { csrf } from 'hono/csrf';
import { html } from 'hono/html';
import { HTTPException } from 'hono/http-exception';
import syllabusJson from '../data/syllabus.json';
import {
  DEFAULT_OPENAI_BASE,
  PROVIDERS,
  aiHost,
  extractPage,
  groupQuestions,
  notesQuery,
  notesTerms,
  pickPages,
  sanitizeGroups,
  testConnection,
  writeAnswer,
  type AiConfig,
  type NotePage,
  type Provider,
  type Syllabus,
} from './ai';
import { groupStats, type Member } from './priority';
import {
  AnswerBlock,
  Layout,
  DesignPage,
  LoginPage,
  INLINE_SCRIPTS,
  PaperList,
  PriorityPage,
  CardsPage,
  PriorityTables,
  PrintPage,
  QuestionCard,
  ReviewPage,
  SettingsPage,
  SetupPage,
  UploadPage,
  summarize,
  type AnswerRow,
  type GroupRow,
  type PaperRow,
  type QuestionRow,
} from './views';

// No secrets in env: passcode, session secret and AI key all live in D1 `settings`, edited from /settings.
type Env = { DB: D1Database; BUCKET: R2Bucket };
type AppSettings = { passcode_hash?: string; passcode_salt?: string; session_secret?: string };
type App = { Bindings: Env; Variables: { userId: string; app: AppSettings } };

const syllabus = syllabusJson as Syllabus;
const SUBJECTS = Object.keys(syllabus);
const DEFAULT_SUBJECT = SUBJECTS[0];
const syllabusEmpty = Object.values(syllabus).every((s) => Object.values(s.units).every((u) => !u.topics.length));
const COOKIE = 'pyq_session';
const MAX_PAGE_BYTES = 4 * 1024 * 1024;
const APP_SCOPE = '_app';
const MIN_PASSCODE = 8;

const app = new Hono<App>();
const page = (c: Context, el: unknown) => c.html(html`<!doctype html>${el}`);
const subjectOr404 = (code: string) => (SUBJECTS.includes(code) ? code : null);

// ---------- Settings storage (D1) ----------
async function readSettings(db: D1Database, scope: string): Promise<Record<string, string>> {
  const rows = (await db.prepare('SELECT k, v FROM settings WHERE user_id = ?').bind(scope).all<{ k: string; v: string }>()).results;
  return Object.fromEntries(rows.map((r) => [r.k, r.v]));
}
function writeSettings(db: D1Database, scope: string, kv: Record<string, string>) {
  const stmt = db.prepare(
    `INSERT INTO settings (user_id, k, v, updated_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at`,
  );
  return db.batch(Object.entries(kv).map(([k, v]) => stmt.bind(scope, k, v)));
}
async function loadAi(db: D1Database, uid: string): Promise<AiConfig | null> {
  const s = await readSettings(db, uid);
  const provider = (s.ai_provider in PROVIDERS ? s.ai_provider : null) as Provider | null;
  if (!provider || !s.ai_key || !s.ai_model) return null;
  return { provider, model: s.ai_model, apiKey: s.ai_key, baseUrl: s.ai_base_url || '' };
}

// ---------- Auth (single user; userId lives here so multi-user later = replace this block) ----------
function randomHex(bytes: number) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function hashPasscode(passcode: string, salt: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${passcode}`));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function passcodeMatches(a: AppSettings, passcode: string) {
  if (!a.passcode_hash || !a.passcode_salt) return false;
  const enc = new TextEncoder();
  const got = enc.encode(await hashPasscode(passcode, a.passcode_salt));
  const want = enc.encode(a.passcode_hash);
  return got.length === want.length && crypto.subtle.timingSafeEqual(got, want);
}
function setSession(c: Context, secret: string) {
  // prefix 'host' → cookie is named __Host-pyq_session: browser enforces Secure, Path=/, no Domain (no subdomain cookie injection).
  return setSignedCookie(c, COOKIE, 'me', secret, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: 60 * 60 * 24 * 60, prefix: 'host' });
}

// CSP: only our own scripts, pdf.js (upload page), and the inline scripts in views.tsx (by hash, computed once per isolate).
const PDFJS_SRC = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/';
let cspValue: Promise<string> | undefined;
async function sha256b64(s: string) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return btoa(String.fromCharCode(...d));
}
export function contentSecurityPolicy() {
  cspValue ??= Promise.all(INLINE_SCRIPTS.map(sha256b64)).then(
    (h) =>
      `script-src 'self' ${PDFJS_SRC} 'wasm-unsafe-eval' ${h.map((x) => `'sha256-${x}'`).join(' ')}; worker-src 'self' blob: ${PDFJS_SRC}; ` +
      "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
  );
  return cspValue;
}

// Security headers on every Worker response (static files get theirs from public/_headers).
// Referrer-Policy must keep same-origin Origin headers: csrf() rejects `Origin: null` (which "no-referrer" would send).
app.use('*', async (c, next) => {
  await next();
  c.header('X-Frame-Options', 'DENY');
  c.header('Content-Security-Policy', await contentSecurityPolicy());
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'same-origin');
  c.header('Strict-Transport-Security', 'max-age=31536000');
});
app.use(csrf());
app.use('*', async (c, next) => {
  c.set('app', (await readSettings(c.env.DB, APP_SCOPE)) as AppSettings);
  await next();
});

// First run: no passcode yet → whoever opens the app sets it. Do this right after deploy.
app.get('/setup', (c) => (c.var.app.passcode_hash ? c.redirect('/login') : page(c, <SetupPage />)));
app.post('/setup', async (c) => {
  if (c.var.app.passcode_hash) return c.redirect('/login');
  const f = await c.req.parseBody();
  const pass = String(f.passcode ?? '');
  if (pass.length < MIN_PASSCODE || pass !== String(f.confirm ?? ''))
    return page(c, <SetupPage error={`Passcode must be at least ${MIN_PASSCODE} characters and both fields must match.`} />);
  const salt = randomHex(16);
  const secret = randomHex(32);
  await writeSettings(c.env.DB, APP_SCOPE, { passcode_salt: salt, passcode_hash: await hashPasscode(pass, salt), session_secret: secret });
  await setSession(c, secret);
  return c.redirect('/settings?saved=setup');
});

// Login brute-force limit, kept in D1 `settings` under user_id '_login' (k = 'ip:<addr>' or '*' for all IPs).
// v = wrong tries, updated_at = start of the current window. Already-logged-in devices are never affected.
const LOGIN_SCOPE = '_login';
const LOGIN_MAX_PER_IP = 5;
const LOGIN_MAX_TOTAL = 30;
const LOGIN_WINDOW = '-15 minutes';
function clientKey(c: Context) {
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  return `ip:${ip.includes(':') ? ip.split(':').slice(0, 4).join(':') : ip}`; // IPv6: one /64 = one client
}
async function loginBlocked(db: D1Database, key: string) {
  const rows = (
    await db
      .prepare(`SELECT k, v FROM settings WHERE user_id = ? AND k IN (?, '*') AND updated_at > datetime('now', ?)`)
      .bind(LOGIN_SCOPE, key, LOGIN_WINDOW)
      .all<{ k: string; v: string }>()
  ).results;
  return rows.some((r) => Number(r.v) >= (r.k === '*' ? LOGIN_MAX_TOTAL : LOGIN_MAX_PER_IP));
}
function recordLoginFail(db: D1Database, key: string) {
  const bump = db.prepare(
    `INSERT INTO settings (user_id, k, v, updated_at) VALUES (?1, ?2, '1', datetime('now'))
     ON CONFLICT(user_id, k) DO UPDATE SET
       v = CASE WHEN settings.updated_at > datetime('now', ?3) THEN CAST(settings.v AS INTEGER) + 1 ELSE 1 END,
       updated_at = CASE WHEN settings.updated_at > datetime('now', ?3) THEN settings.updated_at ELSE datetime('now') END`,
  );
  return db.batch([
    bump.bind(LOGIN_SCOPE, key, LOGIN_WINDOW),
    bump.bind(LOGIN_SCOPE, '*', LOGIN_WINDOW),
    db.prepare(`DELETE FROM settings WHERE user_id = ? AND updated_at <= datetime('now', '-1 day')`).bind(LOGIN_SCOPE),
  ]);
}
const LOCKED = 'Too many wrong tries. Wait 15 minutes and try again.';

app.get('/login', (c) => (c.var.app.passcode_hash ? page(c, <LoginPage />) : c.redirect('/setup')));
app.post('/login', async (c) => {
  const a = c.var.app;
  if (!a.passcode_hash || !a.session_secret) return c.redirect('/setup');
  const db = c.env.DB;
  const key = clientKey(c);
  if (await loginBlocked(db, key)) {
    c.status(429);
    return page(c, <LoginPage error={LOCKED} />);
  }
  const form = await c.req.parseBody();
  if (!(await passcodeMatches(a, String(form.passcode ?? '')))) {
    await recordLoginFail(db, key);
    return page(c, <LoginPage error="Wrong passcode." />);
  }
  await db.prepare('DELETE FROM settings WHERE user_id = ? AND k = ?').bind(LOGIN_SCOPE, key).run();
  await setSession(c, a.session_secret);
  return c.redirect('/');
});
app.get('/logout', (c) => {
  deleteCookie(c, COOKIE, { path: '/', secure: true, prefix: 'host' });
  deleteCookie(c, COOKIE, { path: '/' }); // pre-__Host- cookie name
  c.header('Clear-Site-Data', '"cache", "storage"'); // drop offline answer copies on this device
  return c.redirect('/login');
});

app.use('*', async (c, next) => {
  const a = c.var.app;
  if (!a.passcode_hash || !a.session_secret) return c.req.method === 'GET' ? c.redirect('/setup') : c.text('Not set up', 401);
  const uid = await getSignedCookie(c, a.session_secret, COOKIE, 'host');
  if (!uid) {
    if (c.req.method === 'GET') return c.redirect('/login');
    return c.text('Not logged in', 401);
  }
  c.set('userId', uid);
  await next();
});

// ---------- Settings page ----------
function maskKey(k?: string) {
  return k ? `••••${k.slice(-4)}` : '';
}
async function settingsView(c: Context<App>, flash?: { ok?: string; error?: string }) {
  const [s, papers] = await Promise.all([readSettings(c.env.DB, c.var.userId), listPapers(c.env.DB, c.var.userId)]);
  return page(
    c,
    <SettingsPage
      provider={(s.ai_provider as Provider) || 'gemini'}
      model={s.ai_model || ''}
      baseUrl={s.ai_base_url || ''}
      keyMask={maskKey(s.ai_key)}
      papers={papers}
      flash={flash}
    />,
  );
}
const SAVED: Record<string, string> = {
  setup: 'Passcode set. Now add your AI provider and key below.',
  ai: 'AI settings saved.',
  passcode: 'Passcode changed. All other devices are logged out.',
  session: 'Session secret rotated. All other devices are logged out.',
};
app.get('/design', (c) => page(c, <DesignPage />));
app.get('/settings', (c) => settingsView(c, SAVED[c.req.query('saved') ?? ''] ? { ok: SAVED[c.req.query('saved')!] } : undefined));

app.post('/settings/ai', async (c) => {
  const f = await c.req.parseBody();
  const provider = String(f.provider ?? '');
  if (!(provider in PROVIDERS)) return settingsView(c, { error: 'Unknown provider.' });
  const model = String(f.model ?? '').trim() || PROVIDERS[provider as Provider].defaultModel;
  if (!model) return settingsView(c, { error: 'Model id is required for this provider.' });
  const baseUrl = provider === 'openai' ? String(f.base_url ?? '').trim().slice(0, 300) : '';
  const host = aiHost(provider, baseUrl);
  if (!host) return settingsView(c, { error: 'Base URL must be a valid https:// URL.' });
  const kv: Record<string, string> = { ai_provider: provider, ai_model: model.slice(0, 200), ai_base_url: baseUrl };
  const key = String(f.api_key ?? '').trim();
  if (key) kv.ai_key = key.slice(0, 500); // blank = keep current key
  else {
    // A saved key only ever goes to the host it was entered for: changing provider/Base URL needs the key again,
    // so a stolen session cannot redirect the stored key to its own server.
    const s = await readSettings(c.env.DB, c.var.userId);
    if (s.ai_key && aiHost(s.ai_provider ?? '', s.ai_base_url ?? '') !== host)
      return settingsView(c, { error: 'Re-enter the API key when you change provider or Base URL.' });
  }
  await writeSettings(c.env.DB, c.var.userId, kv);
  return c.redirect('/settings?saved=ai');
});

app.post('/settings/test', async (c) => {
  const cfg = await loadAi(c.env.DB, c.var.userId);
  if (!cfg) return c.html(<span class="err">Save provider, model and key first.</span>);
  try {
    await testConnection(cfg);
    return c.html(<span class="ok">Connected: {cfg.provider} / {cfg.model} returned valid JSON.</span>);
  } catch (e) {
    return c.html(<span class="err">Failed: {(e as Error).message}</span>);
  }
});

app.post('/settings/passcode', async (c) => {
  const f = await c.req.parseBody();
  if (!(await passcodeMatches(c.var.app, String(f.current ?? '')))) return settingsView(c, { error: 'Current passcode is wrong.' });
  const pass = String(f.passcode ?? '');
  if (pass.length < MIN_PASSCODE || pass !== String(f.confirm ?? ''))
    return settingsView(c, { error: `New passcode must be at least ${MIN_PASSCODE} characters and both fields must match.` });
  const salt = randomHex(16);
  // New passcode also rotates the session secret: anyone holding an old cookie (stolen/forgotten device) is logged out.
  const secret = randomHex(32);
  await writeSettings(c.env.DB, APP_SCOPE, { passcode_salt: salt, passcode_hash: await hashPasscode(pass, salt), session_secret: secret });
  await setSession(c, secret); // keep this device logged in
  return c.redirect('/settings?saved=passcode');
});

app.post('/settings/session', async (c) => {
  const f = await c.req.parseBody();
  const custom = String(f.secret ?? '').trim();
  if (custom && custom.length < 32) return settingsView(c, { error: 'Custom session secret must be at least 32 characters (or leave blank to auto-generate).' });
  const secret = custom || randomHex(32);
  await writeSettings(c.env.DB, APP_SCOPE, { session_secret: secret });
  await setSession(c, secret); // keep this device logged in
  return c.redirect('/settings?saved=session');
});

// ---------- Upload ----------
async function listPapers(db: D1Database, uid: string, code?: string) {
  const sql = `SELECT p.*, (SELECT COUNT(*) FROM questions q WHERE q.paper_id = p.id) AS q_count
               FROM papers p WHERE p.user_id = ?1 ${code ? 'AND p.subject_code = ?2' : ''}
               ORDER BY p.year DESC, p.id DESC`;
  const stmt = code ? db.prepare(sql).bind(uid, code) : db.prepare(sql).bind(uid);
  return (await stmt.all<PaperRow>()).results;
}

app.get('/', async (c) => {
  const [papers, ai] = await Promise.all([listPapers(c.env.DB, c.var.userId), loadAi(c.env.DB, c.var.userId)]);
  return page(c, <UploadPage syllabus={syllabus} paperCount={papers.length} syllabusEmpty={syllabusEmpty} aiReady={!!ai} />);
});

app.post('/api/papers', async (c) => {
  const f = await c.req.parseBody();
  const code = subjectOr404(String(f.subject));
  const year = Number(f.year);
  const pages = Number(f.pages);
  const session = String(f.session ?? '').slice(0, 30);
  if (!code || !Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(pages) || pages < 1 || pages > 40)
    return c.json({ error: 'bad input' }, 400);
  const uid = c.var.userId;
  const row = await c.env.DB.prepare(
    `INSERT INTO papers (user_id, subject_code, year, exam_session, r2_key, page_count) VALUES (?, ?, ?, ?, '', ?) RETURNING id`,
  )
    .bind(uid, code, year, session, pages)
    .first<{ id: number }>();
  const id = row!.id;
  const key = `u/${uid}/${id}/`;
  await c.env.DB.prepare('UPDATE papers SET r2_key = ? WHERE id = ?').bind(key, id).run();
  return c.json({ id });
});

// One page per request: R2 put + one AI call. Re-posting a page replaces its questions (safe retry).
app.post('/api/papers/:id/pages/:n', async (c) => {
  const uid = c.var.userId;
  const id = Number(c.req.param('id'));
  const n = Number(c.req.param('n'));
  const paper = await c.env.DB.prepare('SELECT * FROM papers WHERE id = ? AND user_id = ?').bind(id, uid).first<PaperRow & { r2_key: string }>();
  if (!paper || !Number.isInteger(n) || n < 1 || n > paper.page_count) return c.json({ error: 'not found' }, 404);
  if (c.req.header('content-type') !== 'image/jpeg') return c.json({ error: 'expect image/jpeg' }, 415);
  const jpeg = new Uint8Array(await c.req.arrayBuffer());
  if (!jpeg.length || jpeg.length > MAX_PAGE_BYTES) return c.json({ error: 'bad size' }, 413);

  const ai = await loadAi(c.env.DB, uid);
  if (!ai) return c.json({ error: 'No AI provider/key set. Open Settings.' }, 400);

  await c.env.BUCKET.put(`${paper.r2_key}${n}.jpg`, jpeg, { httpMetadata: { contentType: 'image/jpeg' } });

  let items;
  try {
    items = await extractPage(ai, jpeg, paper.subject_code, syllabus[paper.subject_code]);
  } catch (e) {
    await c.env.DB.prepare(`UPDATE papers SET status = 'error' WHERE id = ?`).bind(id).run();
    return c.json({ error: String((e as Error).message) }, 502);
  }

  const ok = new Set<number>(JSON.parse(paper.pages_ok));
  ok.add(n);
  const status = ok.size >= paper.page_count ? 'done' : 'uploading';
  // Single INSERT…SELECT over a JSON array: 1 query regardless of question count (D1 free = 50 queries/request).
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM questions WHERE paper_id = ? AND page_no = ?').bind(id, n),
    c.env.DB.prepare(
      `INSERT INTO questions (user_id, paper_id, subject_code, year, page_no, raw_text, clean_text, marks, unit, topic, confidence)
       SELECT ?1, ?2, ?3, ?4, ?5, j.value ->> '$.question_text', j.value ->> '$.question_text', j.value ->> '$.marks',
              j.value ->> '$.unit', j.value ->> '$.topic', j.value ->> '$.confidence'
       FROM json_each(?6) j`,
    ).bind(uid, id, paper.subject_code, paper.year, n, JSON.stringify(items)),
    c.env.DB.prepare('UPDATE papers SET pages_ok = ?, status = ? WHERE id = ?').bind(JSON.stringify([...ok].sort((a, b) => a - b)), status, id),
  ]);
  return c.json({ count: items.length, low: items.filter((q) => q.unit === null || q.confidence < 0.6).length, status });
});

// Delete selected papers (Settings → Uploaded papers). Passcode required, checked server-side.
app.post('/papers/delete', async (c) => {
  const db = c.env.DB;
  const uid = c.var.userId;
  const f = await c.req.parseBody({ all: true });
  const ids = ([] as unknown[]).concat(f.id ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const view = async (flash: { ok?: string; error?: string }) => c.html(<PaperList papers={await listPapers(db, uid)} flash={flash} />);
  if (!ids.length) return view({ error: 'Tick at least one paper.' });
  if (!(await passcodeMatches(c.var.app, String(f.passcode ?? '')))) return view({ error: 'Wrong passcode. Nothing deleted.' });
  const json = JSON.stringify(ids);
  const papers = (
    await db.prepare('SELECT r2_key, page_count FROM papers WHERE user_id = ? AND id IN (SELECT value FROM json_each(?))').bind(uid, json).all<{ r2_key: string; page_count: number }>()
  ).results;
  const keys = papers.flatMap((p) => Array.from({ length: p.page_count }, (_, i) => `${p.r2_key}${i + 1}.jpg`));
  if (keys.length) await c.env.BUCKET.delete(keys); // one subrequest for all pages
  await db.batch([
    db.prepare('DELETE FROM questions WHERE user_id = ? AND paper_id IN (SELECT value FROM json_each(?))').bind(uid, json),
    db.prepare('DELETE FROM papers WHERE user_id = ? AND id IN (SELECT value FROM json_each(?))').bind(uid, json),
    // Groups left with no questions would linger on Priority. (Partly-emptied groups keep old counts until Regroup.)
    db.prepare('DELETE FROM question_groups WHERE user_id = ? AND NOT EXISTS (SELECT 1 FROM questions q WHERE q.group_id = question_groups.id)').bind(uid),
  ]);
  return view({ ok: `Deleted ${papers.length} paper${papers.length === 1 ? '' : 's'}. Hit Regroup on Priority to refresh counts.` });
});

// ---------- Review ----------
app.get('/review', (c) => c.redirect(`/review/${DEFAULT_SUBJECT}`));
app.get('/review/:code', async (c) => {
  const code = subjectOr404(c.req.param('code'));
  if (!code) return c.notFound();
  const uid = c.var.userId;
  const paperId = c.req.query('paper') ? Number(c.req.query('paper')) : undefined;
  const lowOnly = c.req.query('low') === '1';
  let sql = 'SELECT * FROM questions WHERE user_id = ?1 AND subject_code = ?2';
  if (paperId) sql += ' AND paper_id = ?3';
  if (lowOnly) sql += ' AND (unit IS NULL OR confidence < 0.6)';
  sql += ' ORDER BY year DESC, paper_id, page_no, id';
  const binds: unknown[] = paperId ? [uid, code, paperId] : [uid, code];
  const [qs, papers] = await Promise.all([
    c.env.DB.prepare(sql).bind(...binds).all<QuestionRow>(),
    listPapers(c.env.DB, uid, code),
  ]);
  return page(c, <ReviewPage syllabus={syllabus} code={code} questions={qs.results} papers={papers} paperId={paperId} lowOnly={lowOnly} />);
});

app.patch('/questions/:id', async (c) => {
  const uid = c.var.userId;
  const id = Number(c.req.param('id'));
  const q = await c.env.DB.prepare('SELECT * FROM questions WHERE id = ? AND user_id = ?').bind(id, uid).first<QuestionRow & { subject_code: string; group_id: number | null }>();
  if (!q) return c.body(null, 404);
  const f = await c.req.parseBody();
  const text = String(f.clean_text ?? '').trim().slice(0, 4000) || q.clean_text;
  const marksN = f.marks === '' || f.marks === undefined ? null : Number(f.marks);
  const marks = marksN !== null && Number.isInteger(marksN) && marksN >= 0 && marksN <= 100 ? marksN : null;
  let unit: number | null = [1, 2, 3, 4, 5].includes(Number(f.unit)) ? Number(f.unit) : null;
  let topic: string | null = String(f.topic ?? '').trim() || null;
  // Topic picked from syllabus decides the unit, so the two never disagree.
  if (topic) {
    for (const [u, un] of Object.entries(syllabus[q.subject_code].units)) if (un.topics.includes(topic)) unit = Number(u);
  }
  if (topic && topic.length > 200) topic = topic.slice(0, 200);
  await c.env.DB.prepare('UPDATE questions SET clean_text = ?, marks = ?, unit = ?, topic = ?, confidence = 1, edited = 1 WHERE id = ?')
    .bind(text, marks, unit, topic, id)
    .run();
  if (q.group_id) await refreshGroup(c.env.DB, uid, q.subject_code, q.group_id);
  const updated = await c.env.DB.prepare('SELECT * FROM questions WHERE id = ?').bind(id).first<QuestionRow>();
  return c.html(<QuestionCard q={updated!} syllabus={syllabus} code={q.subject_code} />);
});

app.delete('/questions/:id', async (c) => {
  const uid = c.var.userId;
  const q = await c.env.DB.prepare('SELECT subject_code, group_id FROM questions WHERE id = ? AND user_id = ?')
    .bind(Number(c.req.param('id')), uid)
    .first<{ subject_code: string; group_id: number | null }>();
  if (!q) return c.body(null, 404);
  await c.env.DB.prepare('DELETE FROM questions WHERE id = ?').bind(Number(c.req.param('id'))).run();
  if (q.group_id) await refreshGroup(c.env.DB, uid, q.subject_code, q.group_id);
  return c.body(null, 200);
});

// ---------- Grouping + priority ----------
async function latestYear(db: D1Database, uid: string, code: string) {
  const r = await db.prepare('SELECT MAX(year) AS y FROM questions WHERE user_id = ? AND subject_code = ?').bind(uid, code).first<{ y: number | null }>();
  return r?.y ?? new Date().getFullYear();
}

/** Recompute one group's stats from its members after an edit/delete (no AI call). */
async function refreshGroup(db: D1Database, uid: string, code: string, groupId: number) {
  const members = (await db.prepare('SELECT paper_id, year, marks, unit, topic FROM questions WHERE group_id = ?').bind(groupId).all<Member>()).results;
  if (!members.length) {
    await db.prepare('DELETE FROM question_groups WHERE id = ?').bind(groupId).run();
    return;
  }
  const s = groupStats(members, await latestYear(db, uid, code));
  await db
    .prepare(
      `UPDATE question_groups SET unit = ?, topic = ?, occurrence_count = ?, years_json = ?, max_marks = ?, priority_score = ?, updated_at = datetime('now') WHERE id = ?`,
    )
    .bind(s.unit, s.topic, s.occurrence_count, JSON.stringify(s.years), s.max_marks, s.priority_score, groupId)
    .run();
}

/** Full rebuild: one AI call merges same-meaning questions, then groups are replaced atomically-ish (2 batches). */
async function regroup(env: Env, uid: string, code: string) {
  const db = env.DB;
  const qs = (
    await db
      .prepare('SELECT id, paper_id, year, clean_text, marks, unit, topic FROM questions WHERE user_id = ? AND subject_code = ?')
      .bind(uid, code)
      .all<Member & { id: number; clean_text: string }>()
  ).results;
  if (!qs.length) {
    await db.prepare('DELETE FROM question_groups WHERE user_id = ? AND subject_code = ?').bind(uid, code).run();
    return;
  }
  const ai = await loadAi(db, uid);
  if (!ai) throw new Error('No AI provider/key set. Open Settings.');
  const input = qs.map((q) => ({ id: q.id, text: q.clean_text, unit: q.unit, topic: q.topic, marks: q.marks }));
  // AI failure must not hide questions: fall back to one group per question, then report the error.
  let aiError: Error | null = null;
  const res = await groupQuestions(ai, code, input).catch((e: Error) => {
    aiError = e;
    return sanitizeGroups({ groups: [] }, input);
  });
  const byId = new Map(qs.map((q) => [q.id, q]));
  const latest = Math.max(...qs.map((q) => q.year));
  // Explicit ids (MAX+1…) so questions get linked in the same batch: fixed query count for any group count.
  // Single-user: no race. Multi-user later: a clash fails the whole transaction; user retries.
  const base = (await db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM question_groups').first<{ m: number }>())!.m;
  const rows = res.groups.map((g, i) => {
    const s = groupStats(g.question_ids.map((id) => byId.get(id)!), latest);
    return { id: base + i + 1, canonical_text: g.canonical_text, ...s, years_json: JSON.stringify(s.years), qids: g.question_ids };
  });
  const link = rows.flatMap((r) => r.qids.map((q) => ({ q, g: r.id })));
  await db.batch([
    db.prepare('DELETE FROM question_groups WHERE user_id = ? AND subject_code = ?').bind(uid, code),
    db
      .prepare(
        `INSERT INTO question_groups (id, user_id, subject_code, unit, topic, canonical_text, occurrence_count, years_json, max_marks, priority_score)
         SELECT j.value ->> '$.id', ?1, ?2, j.value ->> '$.unit', j.value ->> '$.topic', j.value ->> '$.canonical_text',
                j.value ->> '$.occurrence_count', j.value ->> '$.years_json', j.value ->> '$.max_marks', j.value ->> '$.priority_score'
         FROM json_each(?3) j`,
      )
      .bind(uid, code, JSON.stringify(rows)),
    db
      .prepare(
        `UPDATE questions SET group_id = (SELECT j.value ->> '$.g' FROM json_each(?3) j WHERE j.value ->> '$.q' = questions.id)
         WHERE user_id = ?1 AND subject_code = ?2`,
      )
      .bind(uid, code, JSON.stringify(link)),
  ]);
  if (aiError) throw new Error(`${(aiError as Error).message} (showing every question ungrouped for now)`);
}

type GroupDbRow = GroupRow & { a_qid: number | null; a_marks: number | null; a_covered: AnswerRow['covered'] | null; a_text: string | null;
  a_sources: string | null; a_model: string | null; a_created: string | null; s_text: string | null; rep: number | null };

/** Groups for a subject with their saved answer, Samjhao + all member wordings (Priority shows them inline). 2 queries. */
async function loadGroups(db: D1Database, uid: string, code: string): Promise<GroupRow[]> {
  const [g, w] = await db.batch([
    db
      .prepare(
        `WITH g AS MATERIALIZED (SELECT g.*, (SELECT MIN(q.id) FROM questions q WHERE q.group_id = g.id) AS rep
                                 FROM question_groups g WHERE g.user_id = ? AND g.subject_code = ?)
         SELECT g.*, a.question_id AS a_qid, a.marks AS a_marks, a.covered AS a_covered, a.text AS a_text,
                a.sources_json AS a_sources, a.model AS a_model, a.created_at AS a_created, s.text AS s_text
         FROM g
         LEFT JOIN answers a ON a.user_id = g.user_id AND a.question_id = g.rep
         LEFT JOIN samjhao s ON s.user_id = g.user_id AND s.question_id = g.rep
         ORDER BY g.priority_score DESC, g.occurrence_count DESC`,
      )
      .bind(uid, code),
    db
      .prepare('SELECT group_id, clean_text, year, marks FROM questions WHERE user_id = ? AND subject_code = ? AND group_id IS NOT NULL ORDER BY year DESC')
      .bind(uid, code),
  ]);
  const wordings = new Map<number, GroupRow['wordings']>();
  for (const r of w.results as { group_id: number; clean_text: string; year: number; marks: number | null }[]) {
    if (!wordings.has(r.group_id)) wordings.set(r.group_id, []);
    wordings.get(r.group_id)!.push({ clean_text: r.clean_text, year: r.year, marks: r.marks });
  }
  return (g.results as GroupDbRow[]).map(({ a_qid, a_marks, a_covered, a_text, a_sources, a_model, a_created, s_text, rep: _rep, ...row }) => ({
    ...row,
    samjhao: s_text,
    wordings: wordings.get(row.id) ?? [],
    // a topic is often asked as a 2-marker in one year and as a 7/10-marker in another: keep every value, not just the max
    all_marks: [...new Set((wordings.get(row.id) ?? []).map((x) => x.marks).filter((m): m is number => m !== null))].sort((a, b) => a - b),
    answer:
      a_qid !== null && a_text !== null
        ? { question_id: a_qid, marks: a_marks, covered: a_covered ?? 'partial', text: a_text, sources_json: a_sources ?? '[]', model: a_model, created_at: a_created ?? '' }
        : null,
  }));
}

app.post('/subjects/:code/regroup', async (c) => {
  const code = subjectOr404(c.req.param('code'));
  if (!code) return c.notFound();
  let err = '';
  try {
    await regroup(c.env, c.var.userId, code);
  } catch (e) {
    err = (e as Error).message;
  }
  const groups = await loadGroups(c.env.DB, c.var.userId, code);
  return c.html(
    <>
      {err && <p class="err">Regroup failed: {err}</p>}
      <PriorityTables syllabus={syllabus} code={code} groups={groups} />
    </>,
  );
});

app.get('/priority', (c) => c.redirect(`/priority/${DEFAULT_SUBJECT}`));
app.get('/cards', (c) => c.redirect(`/cards/${DEFAULT_SUBJECT}`));
app.get('/cards/:code', async (c) => {
  const code = subjectOr404(c.req.param('code'));
  if (!code) return c.notFound();
  return page(c, <CardsPage syllabus={syllabus} code={code} groups={await loadGroups(c.env.DB, c.var.userId, code)} />);
});
app.get('/priority/:code', async (c) => {
  const code = subjectOr404(c.req.param('code'));
  if (!code) return c.notFound();
  return page(c, <PriorityPage syllabus={syllabus} code={code} groups={await loadGroups(c.env.DB, c.var.userId, code)} />);
});
app.get('/priority/:code/print', async (c) => {
  const code = subjectOr404(c.req.param('code'));
  if (!code) return c.notFound();
  return page(c, <PrintPage syllabus={syllabus} code={code} groups={await loadGroups(c.env.DB, c.var.userId, code)} />);
});

export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  // CSV/formula injection: a cell starting = + - @ (OCR'd text) would run as a formula in Excel/Sheets. Numbers stay numbers.
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ---------- Answers (P1a): written only from the student's OCR'd notes (FTS5 table `notes`) ----------
const NOTE_PAGES = 5; // pages sent to the model (~3–4k tokens)
const NOTE_CANDIDATES = 30; // bm25 candidates for pickPages

type AnswerGroup = GroupRow & { subject_code: string; rep: number | null };

async function loadAnswerGroup(db: D1Database, uid: string, id: number) {
  return db
    .prepare('SELECT g.*, (SELECT MIN(q.id) FROM questions q WHERE q.group_id = g.id) AS rep FROM question_groups g WHERE g.id = ? AND g.user_id = ?')
    .bind(id, uid)
    .first<AnswerGroup>();
}

async function findNotes(db: D1Database, uid: string, code: string, unit: number | null, question: string): Promise<NotePage[]> {
  const match = notesQuery(question);
  if (!match) return [];
  const rows = (
    await db
      .prepare('SELECT unit, page_no, text FROM notes WHERE notes MATCH ? AND user_id = ? AND subject_code = ? ORDER BY bm25(notes) LIMIT ?')
      .bind(match, uid, code, NOTE_CANDIDATES)
      .all<NotePage>()
  ).results;
  return pickPages(rows, notesTerms(question), unit, NOTE_PAGES);
}

app.post('/answer/:id', async (c) => {
  const db = c.env.DB;
  const uid = c.var.userId;
  const g = await loadAnswerGroup(db, uid, Number(c.req.param('id')));
  if (!g || g.rep === null) return c.html(<p class="err">Question not found. Regroup changed it — reload this page.</p>);
  const ai = await loadAi(db, uid);
  if (!ai) return c.html(<p class="err">No AI provider/key set. Open Settings.</p>);
  const pages = await findNotes(db, uid, g.subject_code, g.unit, g.canonical_text);
  if (!pages.length) return c.html(<p class="err">No matching pages in your notes for this subject. Import notes first (see CLAUDE.md).</p>);
  let res;
  try {
    res = await writeAnswer(ai, {
      code: g.subject_code,
      subject: syllabus[g.subject_code]?.name ?? '',
      question: g.canonical_text,
      marks: g.max_marks,
      pages,
    });
  } catch (e) {
    return c.html(<p class="err">Answer failed: {(e as Error).message}</p>);
  }
  const row: AnswerRow = {
    question_id: g.rep,
    marks: g.max_marks,
    covered: res.covered,
    text: res.answer,
    sources_json: JSON.stringify(pages.map((p) => ({ unit: p.unit, page: p.page_no }))),
    model: ai.model,
    created_at: new Date().toISOString().slice(0, 16).replace('T', ' '),
  };
  await db
    .prepare(
      `INSERT INTO answers (user_id, question_id, subject_code, marks, covered, text, sources_json, model, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, question_id) DO UPDATE SET marks = excluded.marks, covered = excluded.covered, text = excluded.text,
         sources_json = excluded.sources_json, model = excluded.model, created_at = excluded.created_at`,
    )
    .bind(uid, row.question_id, g.subject_code, row.marks, row.covered, row.text, row.sources_json, row.model)
    .run();
  return c.html(<AnswerBlock groupId={g.id} answer={row} />);
});

app.get('/priority/:code/csv', async (c) => {
  const code = subjectOr404(c.req.param('code'));
  if (!code) return c.notFound();
  const groups = await loadGroups(c.env.DB, c.var.userId, code);
  const rows = [['subject', 'unit', 'unit_title', 'topic', 'question', 'times_asked', 'years', 'max_marks', 'priority_score']];
  const titles = new Map(summarize(syllabus, code, groups).map((s) => [s.unit, s.title]));
  const sorted = [...groups].sort((a, b) => (a.unit ?? 9) - (b.unit ?? 9) || b.priority_score - a.priority_score);
  for (const g of sorted)
    rows.push([code, String(g.unit ?? ''), titles.get(g.unit) ?? '', g.topic ?? '', g.canonical_text, String(g.occurrence_count),
      (JSON.parse(g.years_json) as number[]).join(' '), String(g.max_marks ?? ''), String(g.priority_score)]);
  const body = '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  return c.body(body, 200, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="pyq-priority-${code}.csv"`,
  });
});

/** R2 key of a notes page, or null unless subject is known and unit 1-5, page 1-500 are plain integers (no traversal). */
export function notesKey(code: string, unit: string, page: string) {
  if (!subjectOr404(code) || !/^[1-5]$/.test(unit) || !/^[1-9]\d{0,2}$/.test(page) || Number(page) > 500) return null;
  return `notes/${code}/U${unit}/p${page}.jpg`;
}

// Original notes page images (student's own notes, private R2, behind login): figures link here as "original notes".
app.get('/notes-page/:code/:unit/:page', async (c) => {
  const key = notesKey(c.req.param('code'), c.req.param('unit'), c.req.param('page'));
  if (!key) return c.notFound();
  const obj = await c.env.BUCKET.get(key);
  if (!obj) return c.text('This notes page is not uploaded yet.', 404);
  return c.body(obj.body, 200, { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=604800' });
});

// Any uncaught error (e.g. D1 free-tier daily read limit) → a readable page instead of a bare 500. Uses no DB.
app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse(); // e.g. csrf() 403: not an outage
  const msg = String((err as Error)?.message ?? err);
  const limit = /limit|exceeded|7500/i.test(msg);
  console.error('unhandled', msg);
  return c.html(
    html`<!doctype html>${(
      <Layout title="Unavailable" bare>
        <div class="card">
          <h1>Back soon</h1>
          {limit ? (
            <p>
              The free database has used up today's read limit. It resets at <b>5:30 AM IST</b> (00:00 UTC). Your papers and answers are safe.
            </p>
          ) : (
            <p class="err">Something went wrong: {msg.slice(0, 200)}</p>
          )}
          <p class="muted">On your phone, the installed app can still show answers saved for offline use.</p>
        </div>
      </Layout>
    )}`,
    503,
  );
});

export default app;
