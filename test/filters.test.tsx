import { describe, expect, it } from 'vitest';
import { Filters } from '../src/views';

describe('Filters', () => {
  it('builds unit + marks chips with counts and CSS rules from the data present', async () => {
    const html = String(await (<Filters units={[3, null, 1, 3]} marks={[[10], [2], [7], [2], []]} />).toString());
    expect([...html.matchAll(/<label for="(f[um]-[^"]+)"/g)].map((m) => m[1])).toEqual([
      'fu-all', 'fu-1', 'fu-3', 'fu-0', 'fm-all', 'fm-2', 'fm-7', 'fm-10',
    ]);
    expect(html).toContain('body:has(#fu-3:checked) section[data-u]:not([data-u="3"])');
    expect(html).toContain('body:has(#fm-10:checked) [data-m]:not([data-m~="10"])');
    expect(html).toContain('body:has(#fm-10:checked) section[data-u]:not(:has([data-m~="10"]))');
    expect(html).toContain('<label for="fm-2">2<small> 2</small></label>'); // 2 questions shown as 2 marks
    expect(html).toContain('<label for="fu-3">3<small> 2</small></label>');
  });
  it('omits the marks row when no marks are known', async () => {
    const html = String(await (<Filters units={[1]} marks={[]} />).toString());
    expect(html).not.toContain('fm-all');
  });
  it('counts a group under every marks value it was asked for', async () => {
    const html = String(await (<Filters units={[1, 1]} marks={[[2, 10], [2]]} />).toString());
    expect(html).toContain('<label for="fm-2">2<small> 2</small></label>'); // both groups are askable as 2-markers
    expect(html).toContain('<label for="fm-10">10<small> 1</small></label>');
  });
});
