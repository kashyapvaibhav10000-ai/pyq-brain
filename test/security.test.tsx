import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { aiHost } from '../src/ai';
import { contentSecurityPolicy, csvCell, notesKey } from '../src/index';
import { INLINE_SCRIPTS, Layout, PrintPage } from '../src/views';
import { Filters } from '../src/views';

describe('csvCell', () => {
  it('neutralises formula cells', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('+1+1')).toBe("'+1+1");
    expect(csvCell('-cmd')).toBe("'-cmd");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });
  it('keeps numbers and normal text', () => {
    expect(csvCell(-3)).toBe('-3');
    expect(csvCell('2.5')).toBe('2.5');
    expect(csvCell('Define drug')).toBe('Define drug');
    expect(csvCell(null)).toBe('');
  });
});

describe('Filters', () => {
  it('drops non-integer values before they reach the <style> block', async () => {
    const bad = '1"]{}</style><script>alert(1)</script>' as unknown as number;
    const html = String(await (<Filters units={[1, bad]} marks={[[2, bad]]} />).toString());
    expect(html).not.toContain('<script>');
    expect(html).toContain('fm-2');
  });
});

describe('aiHost (saved key only goes to the host it was entered for)', () => {
  it('fixed hosts for gemini/anthropic, Base URL host for openai', () => {
    expect(aiHost('gemini', 'https://evil.example')).toBe('generativelanguage.googleapis.com');
    expect(aiHost('anthropic', '')).toBe('api.anthropic.com');
    expect(aiHost('openai', '')).toBe('api.openai.com');
    expect(aiHost('openai', 'https://OpenRouter.ai/api/v1')).toBe('openrouter.ai');
    expect(aiHost('openai', 'https://attacker.example/v1')).toBe('attacker.example');
  });
  it('rejects non-https and credentials in URL', () => {
    expect(aiHost('openai', 'http://api.openai.com/v1')).toBeNull();
    expect(aiHost('openai', 'https://u:p@api.openai.com/v1')).toBeNull();
    expect(aiHost('openai', 'not a url')).toBeNull();
  });
});

describe('notesKey', () => {
  it('builds key for valid params', () => {
    expect(notesKey('BP501T', '3', '12')).toBe('notes/BP501T/U3/p12.jpg');
  });
  it('rejects traversal and out-of-range values', () => {
    for (const [c, u, p] of [
      ['..', '1', '1'],
      ['../..', '1', '1'],
      ['BP501T/../x', '1', '1'],
      ['BP501T', '0', '1'],
      ['BP501T', '6', '1'],
      ['BP501T', '1.0', '1'],
      ['BP501T', '1', '0'],
      ['BP501T', '1', '501'],
      ['BP501T', '1', '01'],
      ['BP501T', '1', '1e2'],
      ['BP501T', '1', '../1'],
    ])
      expect(notesKey(c, u, p)).toBeNull();
  });
});

describe('CSP', () => {
  it('restricts scripts and allows each inline script by hash', async () => {
    const csp = await contentSecurityPolicy();
    expect(csp).toMatch(/script-src 'self' /);
    expect(csp).not.toContain('unsafe-inline');
    expect(csp.match(/'sha256-/g)?.length).toBe(INLINE_SCRIPTS.length);
    expect(csp).toContain("frame-ancestors 'none'");
  });
  it('every inline script rendered is in INLINE_SCRIPTS (else the CSP blocks it)', async () => {
    const pages = [<Layout title="Priority">x</Layout>, <PrintPage syllabus={{}} code="BP501T" groups={[]} />];
    for (const el of pages) {
      const html = String(await el.toString());
      for (const m of html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)) expect(INLINE_SCRIPTS).toContain(m[1]);
    }
  });
  it('pdf.js source in the CSP matches upload.js', async () => {
    const js = readFileSync(new URL('../public/upload.js', import.meta.url), 'utf8');
    const src = js.match(/PDFJS = '([^']+)'/)![1];
    const allowed = (await contentSecurityPolicy()).match(/script-src 'self' (\S+) /)![1];
    expect(src.startsWith(allowed)).toBe(true);
  });
  it('print page has no inline event handler', async () => {
    const html = String(await (<PrintPage syllabus={{}} code="BP501T" groups={[]} />).toString());
    expect(html).not.toMatch(/\son[a-z]+=/);
  });
});
