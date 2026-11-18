import { describe, expect, it } from 'vitest';
import { csvCell } from '../src/index';
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
