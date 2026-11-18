import { describe, expect, it } from 'vitest';
import { groupStats, marksWeight, priorityScore, RECENCY_DECAY } from '../src/priority';

describe('priorityScore', () => {
  it('weights marks linearly (m/5), unknown marks = 1', () => {
    expect(marksWeight(10)).toBe(2);
    expect(marksWeight(2)).toBe(0.4);
    expect(marksWeight(null)).toBe(1);
  });
  it('decays by age from latest year', () => {
    expect(priorityScore([{ year: 2024, marks: 5 }], 2024)).toBe(1);
    expect(priorityScore([{ year: 2023, marks: 5 }], 2024)).toBe(RECENCY_DECAY);
  });
  it('sums occurrences; frequent recent long answers win', () => {
    const hot = priorityScore([2022, 2023, 2024].map((year) => ({ year, marks: 10 })), 2024);
    const cold = priorityScore([{ year: 2018, marks: 2 }], 2024);
    expect(hot).toBeCloseTo(2 + 1.6 + 1.28, 2);
    expect(hot).toBeGreaterThan(cold * 10);
  });
  it('never boosts future years', () => {
    expect(priorityScore([{ year: 2030, marks: 5 }], 2024)).toBe(1);
  });
  it('empty = 0', () => expect(priorityScore([], 2024)).toBe(0));
});

describe('groupStats', () => {
  it('counts distinct papers, takes max marks, majority tags', () => {
    const s = groupStats(
      [
        { paper_id: 1, year: 2023, marks: 5, unit: 2, topic: 'A' },
        { paper_id: 1, year: 2023, marks: 10, unit: 2, topic: 'A' }, // OR-choice in same paper
        { paper_id: 2, year: 2024, marks: 10, unit: null, topic: null },
      ],
      2024,
    );
    expect(s.occurrence_count).toBe(2);
    expect(s.years).toEqual([2023, 2024]);
    expect(s.max_marks).toBe(10);
    expect(s.unit).toBe(2);
    expect(s.topic).toBe('A');
    expect(s.priority_score).toBe(priorityScore([{ year: 2023, marks: 10 }, { year: 2024, marks: 10 }], 2024));
  });
});
