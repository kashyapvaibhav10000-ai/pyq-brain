import type { Child } from 'hono/jsx';
import figuresJson from '../data/figures.json';
import syllabusJson from '../data/syllabus.json';
import { DEFAULT_OPENAI_BASE, PROVIDERS, type Provider, type Syllabus } from './ai';

/** Pages the service worker keeps fresh for offline reading (see public/sw.js). */
const OFFLINE_URLS = Object.keys(syllabusJson).flatMap((c) => [`/priority/${c}`, `/cards/${c}`]);
const SW_SCRIPT = `if('serviceWorker'in navigator){navigator.serviceWorker.register('/sw.js');navigator.serviceWorker.ready.then(function(r){if(navigator.onLine&&r.active)r.active.postMessage({sync:${JSON.stringify(OFFLINE_URLS)}})})}`;

export type QuestionRow = {
  id: number;
  paper_id: number;
  year: number;
  page_no: number;
  raw_text: string;
  clean_text: string;
  marks: number | null;
  unit: number | null;
  topic: string | null;
  confidence: number;
  edited: number;
};
export type PaperRow = {
  id: number;
  subject_code: string;
  year: number;
  exam_session: string;
  page_count: number;
  pages_ok: string;
  status: string;
  created_at: string;
  q_count?: number;
};
export type GroupRow = {
  id: number;
  unit: number | null;
  topic: string | null;
  canonical_text: string;
  occurrence_count: number;
  years_json: string;
  max_marks: number | null;
  all_marks?: number[]; // every marks value asked in this group (a topic may be asked as 2 and as 10)
  priority_score: number;
  answer?: AnswerRow | null; // saved answer (keyed by the group's MIN question id)
  samjhao?: string | null; // P2: simple Hinglish explanation, same key as the answer
  wordings?: { clean_text: string; year: number; marks: number | null }[];
};
export type AnswerRow = {
  question_id: number;
  marks: number | null;
  covered: 'full' | 'partial' | 'none';
  text: string;
  sources_json: string;
  model: string | null;
  created_at: string;
};

export const LOW_CONFIDENCE = 0.6;
const SESSIONS = ['Nov-Dec', 'May-Jun', 'Supplementary', 'Other'];

/** Small hand-drawn-style line icons for the sidebar (decoration; the label is the accessible name). */
const ICON: Record<string, string> = {
  Upload: 'M12 16V5M7.5 9.2c1.6-1.5 3-3 4.5-4.4 1.5 1.5 2.9 2.9 4.4 4.5M4.8 15.5c-.2 1.6-.1 3 .2 4.2 4.6.3 9.3.3 14 0 .3-1.3.4-2.7.2-4.3',
  Review: 'M5.2 4.6c4.6-.2 9.2-.2 13.7 0 .2 5 .2 10 0 14.9-4.6.2-9.1.2-13.7 0-.2-5-.2-9.9 0-14.9ZM8.3 12.2c1.1 1 2 2 2.9 3 1.6-2.4 3.3-4.6 5.1-6.6',
  Priority: 'M12 3.8c.9 2 1.7 3.9 2.6 5.8 2 .2 4.1.4 6.1.7-1.5 1.4-3 2.8-4.6 4.2.4 2 .9 4.1 1.3 6.1-1.8-1-3.6-2.1-5.4-3.2-1.8 1.1-3.6 2.2-5.4 3.2.4-2 .8-4.1 1.3-6.1-1.6-1.4-3.1-2.8-4.6-4.2 2-.3 4.1-.5 6.1-.7.9-1.9 1.7-3.8 2.6-5.8Z',
  Settings: 'M12 8.6c1.9 0 3.4 1.5 3.4 3.4s-1.5 3.4-3.4 3.4-3.4-1.5-3.4-3.4 1.5-3.4 3.4-3.4ZM12 3.4v2.4M12 18.2v2.4M3.4 12h2.4M18.2 12h2.4M5.9 5.9l1.7 1.7M16.4 16.4l1.7 1.7M5.9 18.1l1.7-1.7M16.4 7.6l1.7-1.7',
  Logout: 'M14.2 5.1c-2.9-.2-5.8-.2-8.7 0-.2 4.6-.2 9.2 0 13.8 2.9.2 5.8.2 8.7 0M10.6 12h9.8M16.8 8.4c1.2 1.2 2.4 2.4 3.6 3.6-1.2 1.2-2.4 2.4-3.6 3.6',
  Pin: 'M9.2 3.8c1.9-.1 3.7-.1 5.6 0-.3 1.9-.4 3.8-.3 5.7 1.4.9 2.5 2.1 3.3 3.6-4 .2-7.9.2-11.8 0 .8-1.5 1.9-2.7 3.3-3.6.1-1.9 0-3.8-.1-5.7ZM12 13.2v7',
  Cards: 'M6.4 7.6c4.5-.2 9-.2 13.5 0 .2 3.8.2 7.6 0 11.4-4.5.2-9 .2-13.5 0-.2-3.8-.2-7.6 0-11.4ZM3.9 15.4c-.2-3.6-.2-7.2 0-10.8 4.3-.2 8.6-.2 12.9 0M10 13.2c1.8 0 3.6 0 5.4.1',
  Menu: 'M4.4 6.6c5-.2 10.1-.2 15.2 0M4.2 12c5.2-.1 10.3-.1 15.5.1M4.4 17.4c5-.2 10.1-.2 15.2 0',
};
const Icon = (props: { name: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d={ICON[props.name]} />
  </svg>
);
const NAV = [
  ['/', 'Upload'],
  ['/review', 'Review'],
  ['/priority', 'Priority'],
  ['/cards', 'Cards'],
  ['/settings', 'Settings'],
] as const;
// Runs before first paint so a pinned sidebar does not jump.
// Also: page-turn direction. Going "back" (history back, or to an earlier subject/page) turns the page the other way.
const PIN_SCRIPT =
  "try{if(localStorage.getItem('pyq-pin')==='1')document.documentElement.classList.add('pinned')}catch(e){}" +
  "addEventListener('pagereveal',function(e){var t=e.viewTransition,n=window.navigation&&navigation.activation;if(!t||!n||!n.from)return;" +
  "var o=['/','/review','/priority','/settings'],r=function(u){u=new URL(u).pathname;var m=u.match(/BP50(\\d)T/);return o.findIndex(function(p){return p==='/'?u==='/':u.indexOf(p)===0})*10+(m?+m[1]:0)};" +
  "var back=n.navigationType==='traverse'?n.entry.index<n.from.index:r(n.entry.url)<r(n.from.url);if(back)t.types.add('back')});";

const PRINT_SCRIPT = "document.getElementById('print-btn').onclick=function(){print()}";
/** Every inline <script> body. The CSP (index.tsx) allows exactly these, by hash; add any new inline script here. */
export const INLINE_SCRIPTS = [PIN_SCRIPT, SW_SCRIPT, PRINT_SCRIPT];

/** Small notebook doodle for the brand (decoration, hidden from screen readers). */
const Notebook = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
    <path d="M6.2 3.1c4-.2 8.3-.1 12.4.1.3 5.8.4 11.8-.1 17.7-4 .3-8.2.2-12.3 0-.3-5.9-.3-11.9 0-17.8Z" fill="var(--sticky-yellow)" />
    <path d="M9.4 3.4c.1 5.8.1 11.6-.1 17.4M4.2 7.1h3.5M4.3 12h3.4M4.1 16.9h3.6M12 8.2c1.6-.1 3.1 0 4.5.1M12 11.6c1.4 0 2.8 0 4.3.1" />
  </svg>
);

/**
 * Page shell. `bare` = no nav/htmx (login, setup, print). `print` = white print page.
 * The current nav item is derived from the title's first word (Upload, Review, Priority, Settings).
 */
export function Layout(props: { title: string; children: Child; bare?: boolean; print?: boolean; scripts?: string[] }) {
  const current = props.title.split(' ')[0];
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title} · PYQ Brain</title>
        <link rel="preload" href="/fonts/KevinSans-Regular.woff2" as="font" type="font/woff2" crossorigin="" />
        <link rel="stylesheet" href="/app.css" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="theme-color" content="#a8c8bb" />
        <link rel="icon" href="/icon-192.png" />
        {!props.bare && <script dangerouslySetInnerHTML={{ __html: PIN_SCRIPT }} />}
        {!props.bare && <script src="/htmx.min.js" defer></script>}
        {!props.bare && <script src="/shell.js" defer></script>}
        {(props.scripts ?? []).map((s) => (
          <script src={s} defer></script>
        ))}
      </head>
      <body class={props.print ? 'print' : props.bare ? 'bare' : ''}>
        {!props.bare && (
          <>
            <header class="mbar">
              <button class="iconbtn" id="menu-btn" aria-controls="side" aria-expanded="false" aria-label="Open menu">
                <Icon name="Menu" />
              </button>
              <a class="brand" href="/priority">
                <Notebook />
                PYQ Brain
              </a>
            </header>
            <aside class="side" id="side" aria-label="Main menu">
              <div class="side-top">
                <a class="brand" href="/priority">
                  <Notebook />
                  <span class="lbl">PYQ Brain</span>
                </a>
                <button class="iconbtn pin" id="pin-btn" aria-pressed="false" title="Pin sidebar open" aria-label="Pin sidebar">
                  <Icon name="Pin" />
                </button>
              </div>
              <nav>
                {NAV.map(([href, label]) => (
                  <a href={href} aria-current={label === current ? 'page' : undefined} title={label}>
                    <Icon name={label} />
                    <span class="lbl">{label}</span>
                  </a>
                ))}
              </nav>
              <a class="side-bottom" href="/logout" title="Logout">
                <Icon name="Logout" />
                <span class="lbl">Logout</span>
              </a>
            </aside>
            <div class="scrim" id="scrim" hidden></div>
          </>
        )}
        <main>{props.children}</main>
        {!props.bare && (
          <script
            dangerouslySetInnerHTML={{
              __html: SW_SCRIPT,
            }}
          />
        )}
      </body>
    </html>
  );
}

export function SubjectPicker(props: { syllabus: Syllabus; base: string; current?: string }) {
  return (
    <p class="tabs">
      {Object.entries(props.syllabus).map(([code, s]) => (
        <a href={`${props.base}${code}`} class={code === props.current ? 'on' : ''} title={s.name}>
          {code}
        </a>
      ))}
    </p>
  );
}

export function LoginPage(props: { error?: string }) {
  return (
    <Layout title="Login" bare>
      <form method="post" action="/login" class="card narrow">
        <h1>PYQ Brain</h1>
        {props.error && <p class="err">{props.error}</p>}
        <label>
          Passcode
          <input type="password" name="passcode" autofocus required autocomplete="current-password" />
        </label>
        <button class="primary">Enter</button>
      </form>
    </Layout>
  );
}

export function SetupPage(props: { error?: string }) {
  return (
    <Layout title="Setup" bare>
      <form method="post" action="/setup" class="card narrow">
        <h1>PYQ Brain setup</h1>
        <p class="muted">First run. Choose the passcode you will use to log in. You can change it later in Settings.</p>
        {props.error && <p class="err">{props.error}</p>}
        <label>
          New passcode (min 8 characters)
          <input type="password" name="passcode" autofocus required minlength={8} autocomplete="new-password" />
        </label>
        <label>
          Confirm passcode
          <input type="password" name="confirm" required minlength={8} autocomplete="new-password" />
        </label>
        <button class="primary">Save &amp; continue</button>
      </form>
    </Layout>
  );
}

export function SettingsPage(props: {
  provider: Provider;
  model: string;
  baseUrl: string;
  keyMask: string;
  papers: PaperRow[];
  flash?: { ok?: string; error?: string };
}) {
  return (
    <Layout title="Settings">
      <h1>Settings</h1>
      {props.flash?.ok && <p class="okbox">{props.flash.ok}</p>}
      {props.flash?.error && <p class="warn">{props.flash.error}</p>}

      <details class="card fold" id="papers">
        <summary>
          <h2>Uploaded papers ({props.papers.length})</h2>
        </summary>
        <PaperList papers={props.papers} />
      </details>

      <form method="post" action="/settings/ai" class="card">
        <h2>AI provider</h2>
        <p class="muted">
          Used for reading papers and grouping questions. The model must accept images. Key is stored in your database and
          never sent back to the browser.
        </p>
        <label>
          Provider
          <select name="provider">
            {(Object.keys(PROVIDERS) as Provider[]).map((p) => (
              <option value={p} selected={p === props.provider}>
                {PROVIDERS[p].label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Model id
          <input name="model" value={props.model} placeholder="e.g. gemini-3.6-flash, claude-sonnet-5-5, or your provider's model id" />
        </label>
        <label>
          Base URL (OpenAI-compatible only; blank = {DEFAULT_OPENAI_BASE})
          <input name="base_url" value={props.baseUrl} placeholder="https://openrouter.ai/api/v1" />
        </label>
        <label>
          API key {props.keyMask && <span class="muted">(current: {props.keyMask}; leave blank to keep)</span>}
          <input type="password" name="api_key" autocomplete="off" placeholder={props.keyMask ? 'unchanged' : 'paste key'} />
        </label>
        <p class="actions">
          <button>Save</button>
          <button type="button" class="ghost" hx-post="/settings/test" hx-target="#test" hx-indicator="#testing" hx-disabled-elt="this">
            Test connection
          </button>
          <span id="testing" class="htmx-indicator muted">testing…</span>
          <span id="test"></span>
        </p>
      </form>

      <form method="post" action="/settings/passcode" class="card">
        <h2>Passcode</h2>
        <label>
          Current passcode
          <input type="password" name="current" required autocomplete="current-password" />
        </label>
        <div class="row">
          <label>
            New passcode (min 8)
            <input type="password" name="passcode" required minlength={8} autocomplete="new-password" />
          </label>
          <label>
            Confirm
            <input type="password" name="confirm" required minlength={8} autocomplete="new-password" />
          </label>
        </div>
        <button>Change passcode</button>
      </form>

      <form method="post" action="/settings/session" class="card">
        <h2>Session secret</h2>
        <p class="muted">Signs your login cookie. Changing it logs out every other device (this one stays logged in).</p>
        <label>
          Custom secret (optional, min 32 characters; blank = generate a random one)
          <input type="password" name="secret" autocomplete="off" />
        </label>
        <button>Rotate secret</button>
      </form>
    </Layout>
  );
}

export function UploadPage(props: { syllabus: Syllabus; paperCount: number; syllabusEmpty: boolean; aiReady: boolean }) {
  const year = new Date().getFullYear();
  return (
    <Layout title="Upload" scripts={['/upload.js']}>
      <h1>Upload paper</h1>
      {!props.aiReady && (
        <p class="warn">
          No AI provider set yet. <a href="/settings">Open Settings</a> and add your API key before uploading.
        </p>
      )}
      {props.syllabusEmpty && (
        <p class="warn">Syllabus topics are empty — tags will all be low-confidence until data/syllabus.json is filled.</p>
      )}
      <form id="up" class="card">
        <label>
          Subject
          <select name="subject" required>
            {Object.entries(props.syllabus).map(([code, s]) => (
              <option value={code}>
                {code} · {s.name}
              </option>
            ))}
          </select>
        </label>
        <div class="row">
          <label>
            Year
            <input type="number" name="year" min="2000" max={year + 1} value={String(year - 1)} required />
          </label>
          <label>
            Session
            <select name="session">
              {SESSIONS.map((s) => (
                <option>{s}</option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Photos or PDF
          <input type="file" name="files" accept="image/*,application/pdf" multiple required />
        </label>
        <button id="go" class="primary">
          Upload &amp; extract
        </button>
        <progress id="bar" value="0" max="1" hidden></progress>
        <ol id="log" class="log"></ol>
        <button type="button" id="retry" hidden>
          Retry failed pages
        </button>
      </form>
      <p class="muted">
        {props.paperCount} papers uploaded. See or delete them in <a href="/settings#papers">Settings → Uploaded papers</a>.
      </p>
    </Layout>
  );
}

/** Uploaded papers (Settings). Deleting needs the passcode, checked on the server. */
export function PaperList(props: { papers: PaperRow[]; flash?: { ok?: string; error?: string } }) {
  return (
    <form
      id="paperform"
      hx-post="/papers/delete"
      hx-target="this"
      hx-swap="outerHTML"
      hx-confirm="Delete the selected papers and all their questions? This cannot be undone."
    >
      {props.flash?.ok && <p class="okbox">{props.flash.ok}</p>}
      {props.flash?.error && <p class="warn">{props.flash.error}</p>}
      {!props.papers.length ? (
        <p class="empty">No papers uploaded yet.</p>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Subject</th>
                <th>Exam</th>
                <th>Pages</th>
                <th>Qs</th>
              </tr>
            </thead>
            <tbody>
              {props.papers.map((p) => (
                <tr>
                  <td>
                    <input type="checkbox" name="id" value={String(p.id)} aria-label={`Select ${p.subject_code} ${p.exam_session} ${p.year}`} />
                  </td>
                  <td>{p.subject_code}</td>
                  <td>
                    {p.exam_session} {p.year}
                  </td>
                  <td class={p.status === 'done' ? '' : 'err'}>
                    {(JSON.parse(p.pages_ok) as number[]).length}/{p.page_count}
                  </td>
                  <td>
                    <a href={`/review/${p.subject_code}?paper=${p.id}`}>{p.q_count ?? 0}</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <label>
            Passcode (needed to delete)
            <input type="password" name="passcode" required autocomplete="current-password" />
          </label>
          <button class="danger">Delete selected</button>
        </>
      )}
    </form>
  );
}

export function ReviewPage(props: {
  syllabus: Syllabus;
  code: string;
  questions: QuestionRow[];
  papers: PaperRow[];
  paperId?: number;
  lowOnly: boolean;
}) {
  const base = `/review/${props.code}`;
  return (
    <Layout title={`Review ${props.code}`}>
      <SubjectPicker syllabus={props.syllabus} base="/review/" current={props.code} />
      <h1>
        Review · {props.code} {props.syllabus[props.code]?.name}
      </h1>
      <p class="filters">
        <a href={base} class={!props.paperId && !props.lowOnly ? 'on' : ''}>
          All
        </a>
        <a href={`${base}?low=1`} class={props.lowOnly ? 'on' : ''}>
          Low confidence
        </a>
        {props.papers.map((p) => (
          <a href={`${base}?paper=${p.id}`} class={props.paperId === p.id ? 'on' : ''}>
            {p.exam_session} {p.year}
          </a>
        ))}
      </p>
      <p class="muted">
        {props.questions.length} questions. Edits save on change. After fixing tags, hit Regroup on the Priority page.
      </p>
      {props.questions.map((q) => (
        <QuestionCard q={q} syllabus={props.syllabus} code={props.code} />
      ))}
    </Layout>
  );
}

export function QuestionCard(props: { q: QuestionRow; syllabus: Syllabus; code: string }) {
  const { q } = props;
  const s = props.syllabus[props.code];
  const low = q.confidence < LOW_CONFIDENCE || q.unit === null;
  const hasTopics = s && Object.values(s.units).some((u) => u.topics.length);
  return (
    <article class={`card q${low ? ' low' : ''}${q.edited ? ' fixed' : ''}`} id={`q${q.id}`}>
      <form hx-patch={`/questions/${q.id}`} hx-trigger="change" hx-target="closest article" hx-swap="outerHTML">
        <textarea name="clean_text" rows={2}>
          {q.clean_text}
        </textarea>
        <div class="row">
          <label>
            Unit
            <select name="unit">
              <option value="">?</option>
              {[1, 2, 3, 4, 5].map((u) => (
                <option value={String(u)} selected={q.unit === u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
          <label class="grow">
            Topic
            {hasTopics ? (
              <select name="topic">
                <option value="">?</option>
                {Object.entries(s.units).map(([u, unit]) => (
                  <optgroup label={`Unit ${u}: ${unit.title}`}>
                    {unit.topics.map((t) => (
                      <option selected={q.topic === t}>{t}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            ) : (
              <input name="topic" value={q.topic ?? ''} />
            )}
          </label>
          <label>
            Marks
            <input type="number" name="marks" min="0" max="100" value={q.marks === null ? '' : String(q.marks)} />
          </label>
        </div>
      </form>
      <small class="muted">
        {q.year} · p{q.page_no} · conf {q.confidence.toFixed(2)}
        {q.edited ? ' · fixed by you' : ''} ·{' '}
        <button
          class="link"
          hx-delete={`/questions/${q.id}`}
          hx-confirm="Delete this question?"
          hx-target="closest article"
          hx-swap="delete"
        >
          delete
        </button>
      </small>
    </article>
  );
}

export type UnitSummary = { unit: number | null; title: string; groups: number; questions: number; score: number };

export function summarize(syllabus: Syllabus, code: string, groups: GroupRow[]): UnitSummary[] {
  const units: (number | null)[] = [1, 2, 3, 4, 5, null];
  return units
    .map((u) => {
      const gs = groups.filter((g) => g.unit === u);
      return {
        unit: u,
        title: u === null ? 'Untagged' : syllabus[code]?.units[String(u)]?.title || '',
        groups: gs.length,
        questions: gs.reduce((a, g) => a + g.occurrence_count, 0),
        score: Math.round(gs.reduce((a, g) => a + g.priority_score, 0) * 100) / 100,
      };
    })
    .filter((s) => s.unit !== null || s.groups > 0);
}


/**
 * Unit + marks filter chips. Pure CSS (radio + :has()), no JS: works offline and survives htmx swaps.
 * Targets: `section[data-u]` (unit block, 0 = untagged) and `[data-m]` items (the marks shown on that question).
 */
/** Every marks value a group was asked for, smallest first. A topic asked as 2 and as 10 belongs to both filters. */
export function groupMarks(g: GroupRow): number[] {
  const all = g.all_marks ?? (g.wordings ?? []).map((w) => w.marks).filter((m): m is number => m !== null);
  const set = [...new Set(all.length ? all : g.max_marks === null ? [] : [g.max_marks])];
  return set.sort((a, b) => a - b);
}

export function Filters(props: { units: (number | null)[]; marks: number[][] }) {
  const count = <T,>(xs: T[]) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<T, number>());
  // Values go into a <style> block: integers only (defence in depth, DB columns are not type-enforced).
  const uc = count(props.units.map((u) => u ?? 0).filter((u) => Number.isInteger(u)));
  const mc = count(props.marks.flat().filter((m) => Number.isInteger(m)));
  const units = [...uc.keys()].sort((a, b) => (a || 9) - (b || 9));
  const marks = [...mc.keys()].sort((a, b) => a - b);
  const css = [
    ...units.map((u) => `body:has(#fu-${u}:checked) section[data-u]:not([data-u="${u}"])`),
    ...marks.flatMap((m) => [
      `body:has(#fm-${m}:checked) [data-m]:not([data-m~="${m}"])`,
      `body:has(#fm-${m}:checked) section[data-u]:not(:has([data-m~="${m}"]))`,
    ]),
  ];
  const chip = (name: string, id: string, label: string, n?: number) => (
    <>
      <input type="radio" name={name} id={id} checked={n === undefined} />
      <label for={id}>
        {label}
        {n !== undefined && <small> {n}</small>}
      </label>
    </>
  );
  return (
    <div class="filterbox noprint" role="group" aria-label="Filters">
      {css.length > 0 && <style dangerouslySetInnerHTML={{ __html: `${css.join(',')}{display:none}` }} />}
      <div class="frow">
        <span class="flabel">Unit</span>
        <div class="filters">
          {chip('fu', 'fu-all', 'All')}
          {units.map((u) => chip('fu', `fu-${u}`, u ? String(u) : '?', uc.get(u)))}
        </div>
      </div>
      {marks.length > 0 && (
        <div class="frow">
          <span class="flabel">Marks</span>
          <div class="filters">
            {chip('fm', 'fm-all', 'All')}
            {marks.map((m) => chip('fm', `fm-${m}`, String(m), mc.get(m)))}
          </div>
        </div>
      )}
    </div>
  );
}

/** One question: tap to open its saved answer inline (works offline: the whole priority page is cached by sw.js). */
function QuestionItem(props: { g: GroupRow; open?: boolean }) {
  const g = props.g;
  const years = (JSON.parse(g.years_json) as number[]).join(', ');
  const marks = groupMarks(g);
  return (
    <details class="qi" id={`g${g.id}`} data-m={marks.join(' ')} open={props.open}>
      <summary>
        <span class="qt">{g.canonical_text}</span>
        <span class="meta">
          <span class="badge" data-m={g.max_marks === null ? '' : String(g.max_marks)}>
            {marks.length ? marks.join(' / ') : '?'} marks
          </span>
          <span>
            asked {g.occurrence_count}× ({years})
          </span>
          {g.topic && <span>{g.topic}</span>}
          <span>score {g.priority_score}</span>
          {g.answer && <span class="ok">✓ answer saved</span>}
        </span>
      </summary>
      <div class="qbody">
        {(g.wordings?.length ?? 0) > 1 && (
          <details>
            <summary class="muted small">All {g.wordings!.length} wordings from papers</summary>
            <ul class="small">
              {g.wordings!.map((w) => (
                <li>
                  {w.clean_text} <span class="muted">({w.year}, {w.marks ?? '?'} marks)</span>
                </li>
              ))}
            </ul>
          </details>
        )}
        {g.samjhao && <Samjhao text={g.samjhao} />}
        <div class="ab">
          {g.answer ? (
            <AnswerBlock groupId={g.id} answer={g.answer} />
          ) : (
            <p class="noprint">
              <button hx-post={`/answer/${g.id}`} hx-target="closest .ab" hx-disabled-elt="this">
                Write answer from my notes<span class="htmx-indicator"> · writing… (up to a minute)</span>
              </button>
            </p>
          )}
        </div>
      </div>
    </details>
  );
}

export function PriorityTables(props: { syllabus: Syllabus; code: string; groups: GroupRow[]; open?: boolean }) {
  const sum = summarize(props.syllabus, props.code, props.groups);
  const total = sum.reduce((a, s) => a + s.score, 0) || 1;
  return (
    <>
      <Filters units={props.groups.map((g) => g.unit)} marks={props.groups.map(groupMarks)} />
      <details class="cov" open={props.open}>
        <summary>Unit coverage</summary>
        <table>
          <thead>
            <tr>
              <th>Unit</th>
              <th>Distinct Qs</th>
              <th>Times asked</th>
              <th>Score</th>
              <th>Share</th>
            </tr>
          </thead>
          <tbody>
            {sum.map((s) => (
              <tr>
                <td>
                  <b>{s.unit === null ? 'Untagged' : `Unit ${s.unit}`}</b>
                  {s.unit !== null && <span class="ut">{s.title}</span>}
                </td>
                <td>{s.groups}</td>
                <td>{s.questions}</td>
                <td>{s.score}</td>
                <td class="share">
                  <span style={`width:${Math.round((s.score / total) * 100)}%`}></span>
                  {Math.round((s.score / total) * 100)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      {sum
        .filter((s) => s.groups)
        .map((s) => (
          <section data-u={String(s.unit ?? 0)}>
            <h2>
              Unit {s.unit ?? '—'} {s.title}
            </h2>
            {props.groups
              .filter((g) => g.unit === s.unit)
              .map((g) => (
                <QuestionItem g={g} open={props.open} />
              ))}
          </section>
        ))}
    </>
  );
}

export function PriorityPage(props: { syllabus: Syllabus; code: string; groups: GroupRow[] }) {
  return (
    <Layout title={`Priority ${props.code}`} scripts={['/search.js']}>
      <div class="pagehead">
        <SubjectPicker syllabus={props.syllabus} base="/priority/" current={props.code} />
        <h1>
          {props.code} · {props.syllabus[props.code]?.name}
        </h1>
        <div class="toolbar noprint">
          <button class="secondary" hx-post={`/subjects/${props.code}/regroup`} hx-target="#prio" hx-indicator="#busy" hx-disabled-elt="this">
            Regroup (AI)
          </button>
          <span id="busy" class="htmx-indicator muted">
            grouping…
          </span>
          <span class="tools">
            <a href={`/cards/${props.code}`}>Flashcards (2 marks)</a>
            <a href={`/priority/${props.code}/csv`}>CSV</a>
            <a href={`/priority/${props.code}/print`} target="_blank">
              Print with answers
            </a>
          </span>
        </div>
      </div>
      <div class="search noprint" role="search">
        <input
          id="q-search"
          type="search"
          placeholder="Search questions and answers…"
          aria-label="Search questions and answers"
          autocomplete="off"
          enterkeyhint="search"
        />
        <div id="q-results" aria-live="polite"></div>
        <p class="hint">Tap a question to see its answer. Saved answers open offline too.</p>
      </div>
      <div id="prio">
        {props.groups.length ? (
          <PriorityTables {...props} />
        ) : (
          <p class="empty">No questions grouped yet. Upload papers, then press Regroup.</p>
        )}
      </div>
    </Layout>
  );
}

export function PrintPage(props: { syllabus: Syllabus; code: string; groups: GroupRow[] }) {
  return (
    <Layout title={`Priority ${props.code}`} bare print>
      <button class="noprint" id="print-btn">
        Print / Save PDF
      </button>
      <script dangerouslySetInnerHTML={{ __html: PRINT_SCRIPT }} />
      <h1>
        {props.code} {props.syllabus[props.code]?.name} — PYQ priority
      </h1>
      <PriorityTables {...props} open />
    </Layout>
  );
}

// ---------- Answers (P1a) ----------
/** Bold spans only. Strings are escaped by Hono JSX, so model output can never inject HTML. */
type Figure = { caption: string; src?: { code: string; unit: number; page: number } };
const FIGURES = figuresJson as Record<string, Figure>;

/** `[[fig:slug]]` in an answer → the SVG from public/fig (scripts/figures.py) + caption + link to the original notes page. */
export function Fig(props: { slug: string }) {
  const f = FIGURES[props.slug];
  if (!f) return <span class="muted">[figure not found: {props.slug}]</span>;
  return (
    <span class="fig" role="figure" aria-label={f.caption}>
      <a href={`/fig/${props.slug}.svg`} target="_blank" rel="noopener" title="Open full size">
        <img src={`/fig/${props.slug}.svg`} alt={f.caption} loading="lazy" decoding="async" />
      </a>
      <span class="figcap">
        {f.caption}
        {f.src && (
          <>
            {' · '}
            <a href={`/notes-page/${f.src.code}/${f.src.unit}/${f.src.page}`} target="_blank" rel="noopener">
              original notes U{f.src.unit} p{f.src.page}
            </a>
          </>
        )}
      </span>
    </span>
  );
}

/** Bold spans and figures. Strings are escaped by Hono JSX, so model output can never inject HTML. */
function inline(s: string): Child[] {
  return s.split(/(\*\*[^*]+\*\*|(?<!\*)\*(?![*\s])[^*]+(?<![\s*])\*(?!\*)|\[\[fig:[a-z0-9-]+\]\])/).map((part) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return <b>{part.slice(2, -2)}</b>;
    if (/^\*[^*]+\*$/.test(part)) return <i>{part.slice(1, -1)}</i>;
    const fig = part.match(/^\[\[fig:([a-z0-9-]+)\]\]$/);
    return fig ? <Fig slug={fig[1]} /> : part;
  });
}

/** Tiny markdown subset the answer prompt asks for: "## heading", "- bullet" / "1. item", **bold**, *italic*, paragraphs.
 *  "✎ …" = fact-check correction. "⚑ …" starts a textbook section (not from the notes) that runs to the end.
 *  Samjhao only: "💡 …" = memory trick (sticky note), "🏠 …" = real-life example. */
export function Md(props: { text: string }) {
  const main: Child[] = [];
  let out = main;
  let ext: Child[] | null = null;
  let list: string[] = [];
  const flush = () => {
    if (list.length) out.push(<ul>{list.map((li) => <li>{inline(li)}</li>)}</ul>);
    list = [];
  };
  for (const raw of props.text.split('\n')) {
    const line = raw.trim();
    const h = line.match(/^#{1,6}\s+(.*)$/);
    const b = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (!line) flush();
    else if (line.startsWith('💡') || line.startsWith('🏠')) {
      flush();
      out.push(<p class={line.startsWith('💡') ? 'yaad' : 'eg'}>{inline(line)}</p>);
    } else if (line.startsWith('✎')) {
      flush();
      out.push(<p class="fix">{inline(line)}</p>); // fact-check correction (red pencil)
    } else if (line.startsWith('⚑') && !ext) {
      flush();
      out = ext = [<p class="exthead">{inline(line)}</p>];
    } else if (h) {
      flush();
      out.push(<h3>{inline(h[1])}</h3>);
    } else if (b) list.push(b[1]);
    else {
      flush();
      out.push(<p>{inline(line)}</p>);
    }
  }
  flush();
  return (
    <div class="answer">
      {main}
      {ext && <section class="ext">{ext}</section>}
    </div>
  );
}

const COVERED = {
  full: ['okbox', 'Written from your notes'],
  partial: ['warn', 'Partly in your notes — parts marked "Not in notes" need your textbook'],
  none: ['warn', 'Not in your notes'],
} as const;


export function AnswerBlock(props: { groupId: number; answer: AnswerRow }) {
  const a = props.answer;
  const [cls, label0] = COVERED[a.covered] ?? COVERED.partial;
  const label = a.text.includes('⚑') ? `${label0} — textbook answer added (marked ⚑)` : label0;
  const src = (JSON.parse(a.sources_json) as { unit: number; page: number }[]).map((p) => `U${p.unit} p${p.page}`).join(', ');
  return (
    <>
      {a.covered !== 'full' && <p class={`${cls} small`}>{label}</p>}
      <Md text={a.text} />
      <p class="muted small">
        Notes pages used: {src || '—'} · {a.created_at}
      </p>
      <p class="noprint">
        <button class="ghost" hx-post={`/answer/${props.groupId}`} hx-target="closest .ab" hx-disabled-elt="this">
          Regenerate<span class="htmx-indicator"> · writing…</span>
        </button>
      </p>
    </>
  );
}

/** P2 Samjhao: closed by default, above the exam answer. "Suno" reads it aloud (shell.js, Web Speech API; hidden where unsupported). */
export function Samjhao(props: { text: string }) {
  return (
    <details class="sj noprint">
      <summary>
        Samjhao <span class="muted small">— simple Hinglish mein</span>
      </summary>
      <p>
        <button type="button" class="ghost" data-suno hidden aria-pressed="false">
          Suno (read aloud)
        </button>
      </p>
      <Md text={props.text} />
    </details>
  );
}

// ---------- Design system specimen (/design): every component in its states, for QA and as living docs ----------
const SWATCHES = [
  ['--desk', 'Desk: page background'], ['--paper', 'Paper: the sheet'], ['--slip', 'Slip: fields, cards'],
  ['--ink', 'Ink: text, outlines'], ['--you', 'Blue felt: links, focus'], ['--pencil', 'Pencil: meta text'],
  ['--marker', 'Marker: main action'], ['--hi', 'Highlighter: current'], ['--red', 'Red pencil: danger'],
  ['--green', 'Green pencil: done'], ['--sticky-yellow', 'Sticky: caution'], ['--rule-blue', 'Rule: list lines'],
] as const;

export function DesignPage() {
  return (
    <Layout title="Design system">
      <h1>Design system</h1>
      <p class="muted">Paper &amp; pen, after Looseleaf. Tokens and rules live in DESIGN.md and public/app.css.</p>
      <h2>Colour: one tool, one job</h2>
      <div class="swatches">
        {SWATCHES.map(([v, label]) => (
          <div class="swatch">
            <i style={`background:var(${v})`}></i>
            <code>{v}</code>
            <br />
            {label}
          </div>
        ))}
      </div>
      <h2>Type</h2>
      <h1>Heading 1 with a highlighter swipe</h1>
      <h3>Heading 3</h3>
      <p>
        Body text in the hand, 17px. <b>Bold drug names</b>, a <a href="#">blue-felt link</a>, and <span class="muted">pencil meta</span>.
      </p>
      <h2>Buttons</h2>
      <p class="actions">
        <button class="primary">Upload &amp; extract</button>
        <button class="secondary">Regroup (AI)</button>
        <button>Write answer</button>
        <button class="ghost">Regenerate</button>
        <button class="danger">Delete selected</button>
        <button disabled>Working…</button>
        <button class="link">delete</button>
      </p>
      <h2>Fields</h2>
      <div class="card">
        <div class="row">
          <label>
            Text
            <input value="Typed text is blue" />
          </label>
          <label>
            Select
            <select>
              <option>Nov-Dec</option>
            </select>
          </label>
        </div>
        <label>
          Invalid (after editing)
          <input type="email" value="not an email" required />
        </label>
        <label>
          File
          <input type="file" />
        </label>
        <label>
          <input type="checkbox" checked /> Checkbox
        </label>
        <progress value="0.6" max="1"></progress>
      </div>
      <h2>Chips, badges, notes</h2>
      <Filters units={[1, 1, 2, null]} marks={[[2], [7], [10], [2, 10]]} />
      <p class="meta">
        <span class="badge" data-m="2">2 marks</span>
        <span class="badge" data-m="5">5 marks</span>
        <span class="badge" data-m="7">7 marks</span>
        <span class="badge" data-m="10">10 marks</span>
        <span class="ok">✓ answer saved</span>
      </p>
      <p class="warn">Sticky note: partly in your notes.</p>
      <p class="okbox">Saved.</p>
      <p class="err">Wrong passcode. Nothing deleted.</p>
      <p class="empty">Empty state: nothing here yet.</p>
      <h2>Ruled list</h2>
      <section data-u="1">
        {[0, 1].map((i) => (
          <details class="qi" open={i === 0}>
            <summary>
              <span class="qt">Classify antihypertensive drugs. Explain the mechanism of action of ACE inhibitors.</span>
              <span class="meta">
                <span class="badge" data-m="10">
                  10 marks
                </span>
                <span>asked 3× (2024, 2025, 2026)</span>
              </span>
            </summary>
            <div class="qbody">
              <div class="ab">
                <Md text={'## Classification\n- **ACE inhibitors:** Enalapril\n- **ARBs:** Losartan'} />
              </div>
            </div>
          </details>
        ))}
      </section>
      <h2>Table</h2>
      <table>
        <thead>
          <tr>
            <th>Unit</th>
            <th>Qs</th>
            <th>Share</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Unit 1</td>
            <td>12</td>
            <td class="share">
              <span style="width:40%"></span>40%
            </td>
          </tr>
        </tbody>
      </table>
    </Layout>
  );
}

// ---------- Flashcards: 2-mark questions with a saved answer; Leitner spaced repetition in public/cards.js ----------
export function CardsPage(props: { syllabus: Syllabus; code: string; groups: GroupRow[] }) {
  const cards = props.groups.filter((g) => groupMarks(g).includes(2) && g.answer);
  const units = [...new Set(cards.map((g) => g.unit ?? 0))].sort((a, b) => (a || 9) - (b || 9));
  return (
    <Layout title={`Cards ${props.code}`} scripts={['/cards.js']}>
      <div class="pagehead">
        <SubjectPicker syllabus={props.syllabus} base="/cards/" current={props.code} />
        <h1>Flashcards · {props.code}</h1>
        <p class="muted small">
          {cards.length} two-mark questions. Tap the card to flip it, then be honest: missed cards come back sooner.
        </p>
      </div>
      {!cards.length ? (
        <p class="empty">No 2-mark answers in this subject yet.</p>
      ) : (
        <div id="deck" data-code={props.code}>
          <div class="deckbar">
            <div class="filters" role="radiogroup" aria-label="Unit">
              <span class="muted small">Unit</span>
              <button type="button" class="chipbtn on" data-unit="all">All</button>
              {units.map((u) => (
                <button type="button" class="chipbtn" data-unit={String(u)}>
                  {u ? String(u) : '?'}
                </button>
              ))}
            </div>
            <p class="deckstats" id="deck-stats" aria-live="polite"></p>
          </div>
          <div class="cardstage">
            {cards.map((g) => (
              <div class="fcard" data-id={String(g.answer!.question_id)} data-unit={String(g.unit ?? 0)} hidden>
                <button type="button" class="fcard-in" aria-label="Flip card">
                  <span class="face front">
                    <span class="fmeta">
                      U{g.unit ?? '?'} · asked {g.occurrence_count}×
                    </span>
                    <span class="fq">{g.canonical_text}</span>
                    <span class="fhint">tap to flip</span>
                  </span>
                  <span class="face back">
                    <span class="fq small">{g.canonical_text}</span>
                    <Md text={g.answer!.text} />
                  </span>
                </button>
              </div>
            ))}
            <p class="empty" id="deck-done" hidden>
              All caught up for now. Come back later for the cards that are due, or{' '}
              <button type="button" class="link" id="deck-more">
                practise all again
              </button>
              .
            </p>
          </div>
          <p class="cardbtns">
            <button type="button" class="danger" id="btn-miss" disabled>
              ✗ Didn't know
            </button>
            <button type="button" class="primary" id="btn-flip">
              Flip
            </button>
            <button type="button" class="secondary" id="btn-hit" disabled>
              ✓ Knew it
            </button>
          </p>
          <p class="muted small center">
            Keys: Space = flip, 1 = didn't know, 2 = knew it. Progress is saved on this device.{' '}
            <button type="button" class="link" id="deck-reset">
              Reset progress
            </button>
          </p>
        </div>
      )}
    </Layout>
  );
}
