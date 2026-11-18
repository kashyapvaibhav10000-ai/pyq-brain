import { describe, expect, it } from 'vitest';
import { AnswerResult, answerLength, answerPrompt, notesQuery, notesTerms, parseWith, pickPages } from '../src/ai';
import { Md, Samjhao } from '../src/views';

describe('notesQuery', () => {
  it('keeps distinctive words, drops exam verbs, quotes each term', () => {
    expect(notesQuery('Write the synthesis, SAR and mechanism of action of Cimetidine.')).toBe(
      '"synthesis" OR "sar" OR "mechanism" OR "action" OR "cimetidine"',
    );
  });
  it('cannot inject FTS syntax', () => {
    const q = notesQuery('Classify "H2" antagonists NEAR(x) OR * AND -drugs')!;
    expect(q).not.toMatch(/NEAR\(|\*|-drugs/);
    expect(q.split(' OR ').every((t) => /^"[a-z0-9]+"$/.test(t))).toBe(true);
  });
  it('returns null when nothing distinctive is left', () => {
    expect(notesQuery('Write a short note on')).toBeNull();
  });
});

describe('answerLength', () => {
  it('scales with marks', () => {
    expect(answerLength(2)).toMatch(/^40–80/);
    expect(answerLength(null)).toMatch(/^40–80/);
    expect(answerLength(5)).toMatch(/^150–250/);
    expect(answerLength(7)).toMatch(/^300–400/);
    expect(answerLength(10)).toMatch(/^450–650/);
  });
});

describe('answer prompt + validation', () => {
  it('labels note pages so the model can cite them', () => {
    const p = answerPrompt({ code: 'BP501T', subject: 'Med Chem II', question: 'MOA of cimetidine', marks: 5, pages: [{ unit: 1, page_no: 3, text: 'Cimetidine blocks H2' }] });
    expect(p).toContain('=== U1 p3 ===\nCimetidine blocks H2');
    expect(p).toContain('150–250 words');
  });
  it('accepts valid and rejects bad model output', () => {
    expect(parseWith(AnswerResult, '{"covered":"full","answer":"x"}')).not.toBeNull();
    expect(parseWith(AnswerResult, '{"covered":"maybe","answer":"x"}')).toBeNull();
    expect(parseWith(AnswerResult, '{"covered":"none","answer":"  "}')).toBeNull();
  });
});

describe('Md', () => {
  it('renders headings, bullets, bold and escapes HTML', async () => {
    const html = String(await (<Md text={'## MOA [U1 p3]\n- **Blocks** H2\n- <script>x</script>\n\nPlain'} />).toString());
    expect(html).toContain('<h3>MOA [U1 p3]</h3>');
    expect(html).toContain('<li><b>Blocks</b> H2</li>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('<p>Plain</p>');
  });
  it('renders correction lines with italics but leaves lone asterisks alone', async () => {
    const html = String(await (<Md text={'✎ **Correction:** fix *(Source: IP)*\n- n→π* band and 5 * 3'} />).toString());
    expect(html).toContain('<p class="fix">✎ <b>Correction:</b> fix <i>(Source: IP)</i></p>');
    expect(html).toContain('<li>n→π* band and 5 * 3</li>');
  });
  it('renders Samjhao memory-trick and real-life-example lines as sticky notes', async () => {
    const html = String(await (<Md text={'Seedhi baat\n💡 **Yaad rakho:** PTU = Pregnancy\n🏠 **Jaise:** pani ka nal'} />).toString());
    expect(html).toContain('<p class="yaad">💡 <b>Yaad rakho:</b> PTU = Pregnancy</p>');
    expect(html).toContain('<p class="eg">🏠 <b>Jaise:</b> pani ka nal</p>');
  });
});

describe('Samjhao', () => {
  it('is a closed fold with a hidden read-aloud button (shown by shell.js only where speech works)', async () => {
    const html = String(await (<Samjhao text={'## Kya hai\n- H2 block'} />).toString());
    expect(html).toMatch(/^<details class="sj noprint"><summary>Samjhao/);
    expect(html).toContain('data-suno="true" hidden=""');
    expect(html).toContain('<h3>Kya hai</h3>');
  });
});

describe('pickPages', () => {
  const page = (unit: number, page_no: number, text: string) => ({ unit, page_no, text });
  it('covers every part of a multi-part question instead of repeating the common part', () => {
    const terms = notesTerms('What is proton pump inhibitor? Explain SAR and synthesis of cimetidine.');
    const cands = [
      page(1, 22, 'proton pump inhibitor proton pump inhibitor omeprazole sar'),
      page(1, 23, 'proton pump inhibitor proton pump lansoprazole'),
      page(1, 24, 'proton pump inhibitor pantoprazole'),
      page(5, 10, 'sar of local anaesthetics synthesis of procaine'),
      page(1, 21, 'synthesis of cimetidine from imidazole'),
    ];
    const got = pickPages(cands, terms, 1, 2).map((p) => p.page_no);
    expect(got).toEqual([21, 22]);
  });
  it('prefers the question unit on ties and returns reading order', () => {
    const got = pickPages([page(3, 5, 'warfarin'), page(2, 9, 'warfarin')], ['warfarin'], 2, 2);
    expect(got.map((p) => `${p.unit}:${p.page_no}`)).toEqual(['2:9', '3:5']);
    expect(pickPages([page(3, 5, 'warfarin'), page(2, 9, 'warfarin')], ['warfarin'], 2, 1)[0].unit).toBe(2);
  });
});
