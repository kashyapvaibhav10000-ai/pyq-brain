import { z } from 'zod';

// ---------- Syllabus types ----------
export type Unit = { title: string; topics: string[]; text?: string }; // text = verbatim unit content (context for the model)
export type SubjectSyllabus = { name: string; units: Record<string, Unit> };
export type Syllabus = Record<string, SubjectSyllabus>;

// ---------- Provider config (stored in D1 via the Settings page) ----------
export const PROVIDERS = {
  gemini: { label: 'Google Gemini', defaultModel: 'gemini-3.6-flash', needsBaseUrl: false },
  openai: { label: 'OpenAI-compatible (OpenAI, OpenRouter, Groq, …)', defaultModel: '', needsBaseUrl: true },
  anthropic: { label: 'Anthropic Claude', defaultModel: 'claude-sonnet-5-5', needsBaseUrl: false },
} as const;
export type Provider = keyof typeof PROVIDERS;
export type AiConfig = { provider: Provider; model: string; apiKey: string; baseUrl: string };
export const DEFAULT_OPENAI_BASE = 'https://api.openai.com/v1';

// ---------- Page extraction: zod (authoritative) + JSON schema (sent to the model) ----------
export const PageItem = z.object({
  question_text: z.string().trim().min(1),
  marks: z.number().int().min(0).max(100).nullable(),
  unit: z.number().int().min(1).max(5).nullable(),
  topic: z.string().trim().min(1).nullable(),
  confidence: z.number().min(0).max(1),
});
// Top-level object (not bare array): required by OpenAI json_schema and Anthropic tool input.
export const PageResult = z.object({ questions: z.array(PageItem) });
export type PageItem = z.infer<typeof PageItem>;

function pageJsonSchema(s: SubjectSyllabus) {
  const topics = Object.values(s.units).flatMap((u) => u.topics);
  const topic = topics.length ? { type: ['string', 'null'], enum: [...topics, null] } : { type: ['string', 'null'] };
  return {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            question_text: { type: 'string' },
            marks: { type: ['integer', 'null'] },
            unit: { type: ['integer', 'null'], minimum: 1, maximum: 5 },
            topic,
            confidence: { type: 'number', minimum: 0, maximum: 1 },
          },
          required: ['question_text', 'marks', 'unit', 'topic', 'confidence'],
        },
      },
    },
    required: ['questions'],
  };
}

export function pagePrompt(subjectCode: string, s: SubjectSyllabus): string {
  return `You read one page of a B.Pharm (PCI syllabus) university exam question paper for subject ${subjectCode} "${s.name}".
Tasks:
1. OCR every question on the page. Split into individual questions. Sub-parts (a, b, c) that are separate questions become separate items. Skip instructions, headers, roll-number boxes.
2. question_text: the question only, cleaned of question numbers like "Q3." or "(a)". Keep chemical names and drug names exact.
3. marks: marks for that ONE question, from the question or its section header. Section headers look like "10 x 2 = 20", "2 x 10 = 20", "5 x 7 = 35" or "7 x 5 = 35": always compute marks = section total ÷ number of questions to attempt (e.g. "Attempt any five … 7 x 5 = 35" → 35 ÷ 5 = 7; "Attempt all … 10 x 2 = 20" → 2). Every question in a section gets that section's marks, even if the header is on an earlier part of the page. null only if no marks are visible at all.
4. unit and topic: MUST come from the syllabus JSON below. topic must be copied exactly from a "topics" string of that unit ("text" is only context to help you decide).
   If you are not sure, set unit=null and/or topic=null and give confidence below 0.5. Never guess silently.
5. confidence: 0..1, your confidence in the unit+topic tagging (and OCR legibility).
Return {"questions": [...]}. If the page has no questions, return {"questions": []}.

Syllabus for ${subjectCode}:
${JSON.stringify(s.units)}`;
}

/**
 * Force unit/topic to be consistent with the syllabus. Anything not traceable gets nulled and low confidence,
 * so it shows up highlighted in Review instead of being silently wrong.
 */
export function normalizeToSyllabus(items: PageItem[], s: SubjectSyllabus): PageItem[] {
  const lookup = new Map<string, { unit: number; topic: string }>();
  for (const [u, unit] of Object.entries(s.units)) {
    for (const t of unit.topics) lookup.set(t.trim().toLowerCase(), { unit: Number(u), topic: t });
  }
  return items.map((it) => {
    const out = { ...it };
    if (out.topic !== null) {
      const hit = lookup.get(out.topic.trim().toLowerCase());
      if (!hit) {
        out.topic = null;
        out.confidence = Math.min(out.confidence, 0.3);
      } else {
        out.topic = hit.topic;
        if (out.unit !== hit.unit) {
          out.unit = hit.unit; // topic is the stronger signal; flag it
          out.confidence = Math.min(out.confidence, 0.5);
        }
      }
    }
    if (out.unit === null) out.confidence = Math.min(out.confidence, 0.3);
    return out;
  });
}

// ---------- Grouping ----------
export const GroupResult = z.object({
  groups: z.array(
    z.object({
      canonical_text: z.string().trim().min(1),
      question_ids: z.array(z.number().int()).min(1),
    }),
  ),
});
export type GroupResult = z.infer<typeof GroupResult>;

const groupJsonSchema = {
  type: 'object',
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          canonical_text: { type: 'string' },
          question_ids: { type: 'array', items: { type: 'integer' }, minItems: 1 },
        },
        required: ['canonical_text', 'question_ids'],
      },
    },
  },
  required: ['groups'],
};

export type GroupInput = { id: number; text: string; unit: number | null; topic: string | null; marks: number | null };

export function groupPrompt(subjectCode: string, qs: GroupInput[]): string {
  return `These are exam questions from past B.Pharm papers for subject ${subjectCode}.
Group questions that ask the SAME thing, even if worded differently (e.g. "Explain MOA of digoxin" and "Write the mechanism of action of cardiac glycosides with digoxin as example" are the same).
Do NOT group questions that are only on the same topic but ask different things (e.g. "classify antihypertensives" vs "MOA of ACE inhibitors" are different).
Return ONLY groups of 2 or more ids (the repeats). Leave out questions that have no repeat; they are added automatically.
An id may appear in at most one group.
canonical_text: one short, clear, exam-style wording that covers the group.
Return {"groups": [...]} ({"groups": []} if nothing repeats).

Questions (JSON):
${JSON.stringify(qs.map((q) => ({ id: q.id, text: q.text, topic: q.topic })))}`;
}

/** Make the model's grouping safe: every known id exactly once, unknown ids dropped, missing ids as singletons. */
export function sanitizeGroups(res: GroupResult, qs: GroupInput[]): GroupResult {
  const known = new Map(qs.map((q) => [q.id, q]));
  const seen = new Set<number>();
  const groups: GroupResult['groups'] = [];
  for (const g of res.groups) {
    const ids = g.question_ids.filter((id) => known.has(id) && !seen.has(id));
    ids.forEach((id) => seen.add(id));
    if (ids.length) groups.push({ canonical_text: g.canonical_text, question_ids: ids });
  }
  for (const q of qs) if (!seen.has(q.id)) groups.push({ canonical_text: q.text, question_ids: [q.id] });
  return { groups };
}

// ---------- Answers from the student's notes (P1a) ----------
// Generic exam verbs/fillers: they match every page, so they only add noise to the bm25 search.
const STOP = new Set(
  'the and with for its their them what which who how why are was were give write explain discuss describe define state list enlist name outline note short notes detail details detailed brief briefly any two three four examples example suitable mention draw illustrate classify classification comment differentiate between about along also give in of on to a an is be by from or as at it this that these those role use uses'.split(
    ' ',
  ),
);

/** Distinctive lowercase words of a question (exam verbs/fillers removed), max 24. */
export function notesTerms(question: string): string[] {
  return [...new Set((question.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) ?? []).filter((w) => !STOP.has(w)))].slice(0, 24);
}

/** FTS5 MATCH expression: terms OR'ed, each quoted (safe against FTS syntax). */
export function notesQuery(question: string): string | null {
  const t = notesTerms(question);
  return t.length ? t.map((w) => `"${w}"`).join(' OR ') : null;
}

/**
 * Choose k pages from bm25 candidates so that every part of a multi-part question is covered.
 * Plain bm25 lets common terms that repeat a lot ("proton pump inhibitor") crowd out the page with the
 * rare one ("cimetidine" synthesis). Greedy pick: gain = Σ weight of question terms on the page, where
 * weight = rarity among candidates, and a term's weight drops to 30% once a picked page covers it.
 * Own unit ×1.3. Ties → original bm25 order. Returns pages sorted by unit/page for reading order.
 */
export function pickPages<T extends NotePage>(candidates: T[], terms: string[], unit: number | null, k: number): T[] {
  const key = (t: string) => t.slice(0, 6); // crude stem: "synthesis"/"synthesized", "inhibitors"/"inhibitor"
  const has = candidates.map((c) => {
    const low = c.text.toLowerCase();
    return new Set(terms.filter((t) => low.includes(key(t))));
  });
  const n = candidates.length;
  const w = new Map(terms.map((t) => [t, Math.log(1 + n / (1 + has.filter((h) => h.has(t)).length))]));
  const left = candidates.map((_, i) => i);
  const picked: number[] = [];
  while (picked.length < k && left.length) {
    let best = -1;
    let bestGain = -1;
    for (const i of left) {
      let g = 0;
      for (const t of has[i]) g += w.get(t)!;
      if (candidates[i].unit === unit) g *= 1.3;
      g -= i * 1e-6; // stable: earlier (better bm25) wins ties
      if (g > bestGain) [best, bestGain] = [i, g];
    }
    picked.push(best);
    left.splice(left.indexOf(best), 1);
    for (const t of has[best]) w.set(t, w.get(t)! * 0.3);
  }
  return picked.map((i) => candidates[i]).sort((a, b) => a.unit - b.unit || a.page_no - b.page_no);
}

/** Exam answer length/shape by marks (PCI B.Pharm pattern: 2 / 5 / 7 / 10). */
export function answerLength(marks: number | null): string {
  if (!marks || marks <= 2) return '40–80 words: a direct definition/answer plus 2–4 key points. No headings.';
  if (marks <= 5) return '150–250 words: one-line intro, then key points under 2–3 short headings.';
  if (marks <= 7) return '300–400 words: intro, then headings covering every part the question asks (e.g. classification, MOA, SAR, uses).';
  return '450–650 words: intro; classification as a bullet list with examples; then a heading for each part asked (structure, synthesis steps, MOA, SAR, uses, adverse effects as relevant); short conclusion.';
}

export const AnswerResult = z.object({
  covered: z.enum(['full', 'partial', 'none']),
  answer: z.string().trim().min(1),
});
export type AnswerResult = z.infer<typeof AnswerResult>;
const answerJsonSchema = {
  type: 'object',
  properties: { covered: { type: 'string', enum: ['full', 'partial', 'none'] }, answer: { type: 'string' } },
  required: ['covered', 'answer'],
};

export type NotePage = { unit: number; page_no: number; text: string };

export function answerPrompt(p: { code: string; subject: string; question: string; marks: number | null; pages: NotePage[] }): string {
  const ref = p.pages.map((n) => `=== U${n.unit} p${n.page_no} ===\n${n.text}`).join('\n\n');
  return `Write a model university exam answer for B.Pharm 5th semester (PCI syllabus), subject ${p.code} ${p.subject}.
Question (${p.marks ?? '?'} marks): ${p.question}

RULES
- Use ONLY the reference notes below (OCR of the student's own notes). Do not add facts that are not in them.
- If part of the question is not in the notes, write "Not in notes: <that part>" instead of answering it from memory.
- The OCR lost all drawings. Where a structure, synthesis scheme or diagram belongs, write "[Draw: <what> — see U<unit> p<page>]" pointing at the notes page.
- Cite the source page after each heading or point, like [U1 p3].
- Length and shape: ${answerLength(p.marks)}
- Format: markdown subset only — "## Heading", "- bullet", **bold**. No tables, no HTML, no code blocks.
- covered: "full" if the notes answer every part, "partial" if some parts are missing, "none" if the notes do not cover it (then answer = "Not in your notes." and name the closest pages).

REFERENCE NOTES
${ref || '(no notes found for this subject)'}`;
}

// ---------- HTTP: one function per provider, all return the raw JSON text ----------
export function toBase64(bytes: Uint8Array): string {
  const anyBytes = bytes as Uint8Array & { toBase64?: () => string };
  if (typeof anyBytes.toBase64 === 'function') return anyBytes.toBase64();
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Parse model text and validate. Returns null on any failure (caller retries). */
export function parseWith<T>(schema: z.ZodType<T>, text: string | undefined): T | null {
  if (!text) return null;
  try {
    const r = schema.safeParse(JSON.parse(text));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

const AI_TIMEOUT_MS = 90_000;
type Call = { prompt: string; imageB64?: string; jsonSchema: object; name: string };
type Raw = { ok: true; text: string | undefined } | { ok: false; error: string };

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<{ ok: boolean; status: number; data: any; text: string }> {
  let res: Response;
  let text: string;
  try {
    // Slow/free models can hang for minutes; cap each attempt so the UI always gets an answer.
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });
    text = await res.text();
  } catch (e) {
    const timedOut = (e as Error).name === 'TimeoutError';
    return { ok: false, status: 0, data: null, text: timedOut ? `no answer after ${AI_TIMEOUT_MS / 1000}s (model too slow)` : String(e) };
  }
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {}
  return { ok: res.ok, status: res.status, data, text };
}

async function callGemini(cfg: AiConfig, c: Call): Promise<Raw> {
  const parts: unknown[] = [];
  if (c.imageB64) parts.push({ inlineData: { mimeType: 'image/jpeg', data: c.imageB64 } });
  parts.push({ text: c.prompt });
  const r = await post(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`,
    { 'x-goog-api-key': cfg.apiKey },
    {
      contents: [{ role: 'user', parts }],
      generationConfig: { responseMimeType: 'application/json', responseJsonSchema: c.jsonSchema, temperature: 0.1 },
    },
  );
  if (!r.ok) return { ok: false, error: `Gemini HTTP ${r.status}: ${r.text.slice(0, 300)}` };
  return { ok: true, text: r.data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') };
}

async function callOpenAI(cfg: AiConfig, c: Call): Promise<Raw> {
  const content: unknown[] = [{ type: 'text', text: c.prompt }];
  if (c.imageB64) content.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${c.imageB64}` } });
  const base = (cfg.baseUrl || DEFAULT_OPENAI_BASE).replace(/\/+$/, '');
  const r = await post(
    `${base}/chat/completions`,
    { authorization: `Bearer ${cfg.apiKey}` },
    {
      model: cfg.model,
      messages: [{ role: 'user', content }],
      max_tokens: 8192, // without it OpenRouter reserves the model max (65k) and 402s on small balances
      response_format: { type: 'json_schema', json_schema: { name: c.name, schema: c.jsonSchema } },
      // Reasoning models can spend the whole max_tokens "thinking" and return empty content. OpenRouter-only param.
      ...(base.includes('openrouter.ai') ? { reasoning: { enabled: false } } : {}),
    },
  );
  if (!r.ok) return { ok: false, error: `OpenAI-compatible HTTP ${r.status}: ${r.text.slice(0, 300)}` };
  return { ok: true, text: r.data?.choices?.[0]?.message?.content };
}

async function callAnthropic(cfg: AiConfig, c: Call): Promise<Raw> {
  const content: unknown[] = [];
  if (c.imageB64) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: c.imageB64 } });
  content.push({ type: 'text', text: c.prompt });
  // Forced tool call = reliable structured JSON output.
  const r = await post(
    'https://api.anthropic.com/v1/messages',
    { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' },
    {
      model: cfg.model,
      max_tokens: 8192,
      messages: [{ role: 'user', content }],
      tools: [{ name: c.name, description: 'Return the result.', input_schema: c.jsonSchema }],
      tool_choice: { type: 'tool', name: c.name },
    },
  );
  if (!r.ok) return { ok: false, error: `Anthropic HTTP ${r.status}: ${r.text.slice(0, 300)}` };
  const tool = r.data?.content?.find((b: { type: string }) => b.type === 'tool_use');
  return { ok: true, text: tool ? JSON.stringify(tool.input) : undefined };
}

const CALLERS: Record<Provider, (cfg: AiConfig, c: Call) => Promise<Raw>> = {
  gemini: callGemini,
  openai: callOpenAI,
  anthropic: callAnthropic,
};

/** One call + one retry on HTTP error or invalid/unvalidated JSON. */
async function generate<T>(cfg: AiConfig, c: Call, schema: z.ZodType<T>): Promise<T> {
  let lastErr = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await CALLERS[cfg.provider](cfg, c);
    if (!raw.ok) {
      lastErr = raw.error;
      continue;
    }
    const parsed = parseWith(schema, raw.text);
    if (parsed !== null) return parsed;
    lastErr = `Invalid JSON from model: ${(raw.text ?? '').slice(0, 300)}`;
  }
  throw new Error(lastErr);
}

export async function extractPage(cfg: AiConfig, jpeg: Uint8Array, subjectCode: string, s: SubjectSyllabus) {
  const res = await generate(
    cfg,
    { prompt: pagePrompt(subjectCode, s), imageB64: toBase64(jpeg), jsonSchema: pageJsonSchema(s), name: 'page_questions' },
    PageResult,
  );
  return normalizeToSyllabus(res.questions, s);
}

export async function groupQuestions(cfg: AiConfig, subjectCode: string, qs: GroupInput[]) {
  const res = await generate(
    cfg,
    { prompt: groupPrompt(subjectCode, qs), jsonSchema: groupJsonSchema, name: 'question_groups' },
    GroupResult,
  );
  return sanitizeGroups(res, qs);
}

/** Cheap connectivity check for the Settings page. */
export async function testConnection(cfg: AiConfig): Promise<void> {
  await generate(
    cfg,
    {
      prompt: 'Reply with {"ok": true}.',
      jsonSchema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
      name: 'ping',
    },
    z.object({ ok: z.boolean() }),
  );
}

export async function writeAnswer(cfg: AiConfig, p: Parameters<typeof answerPrompt>[0]): Promise<AnswerResult> {
  return generate(cfg, { prompt: answerPrompt(p), jsonSchema: answerJsonSchema, name: 'exam_answer' }, AnswerResult);
}
