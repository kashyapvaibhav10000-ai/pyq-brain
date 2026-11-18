import { describe, expect, it } from 'vitest';
import { GroupResult, PageResult, normalizeToSyllabus, parseWith, sanitizeGroups, toBase64, type SubjectSyllabus } from '../src/ai';

const syl: SubjectSyllabus = {
  name: 'Test',
  units: {
    '1': { title: 'U1', topics: ['Cholinergic drugs'] },
    '2': { title: 'U2', topics: ['Antihypertensives'] },
    '3': { title: '', topics: [] },
    '4': { title: '', topics: [] },
    '5': { title: '', topics: [] },
  },
};
const item = (o: object) => ({ question_text: 'Q', marks: 5, unit: 1, topic: 'Cholinergic drugs', confidence: 0.9, ...o });

const page = (items: object[]) => JSON.stringify({ questions: items });

describe('parseWith(PageResult)', () => {
  it('accepts valid {questions: [...]}', () => {
    expect(parseWith(PageResult, page([item({})]))?.questions).toHaveLength(1);
  });
  it('accepts nulls for marks/unit/topic', () => {
    expect(parseWith(PageResult, page([item({ marks: null, unit: null, topic: null })]))).not.toBeNull();
  });
  it('rejects malformed JSON, wrong shape, out-of-range unit/confidence, empty text', () => {
    expect(parseWith(PageResult, '{not json')).toBeNull();
    expect(parseWith(PageResult, undefined)).toBeNull();
    expect(parseWith(PageResult, JSON.stringify([item({})]))).toBeNull(); // bare array no longer accepted
    expect(parseWith(PageResult, JSON.stringify({ items: [] }))).toBeNull();
    expect(parseWith(PageResult, page([item({ unit: 6 })]))).toBeNull();
    expect(parseWith(PageResult, page([item({ confidence: 1.5 })]))).toBeNull();
    expect(parseWith(PageResult, page([item({ question_text: '  ' })]))).toBeNull();
    expect(parseWith(PageResult, page([item({ marks: 2.5 })]))).toBeNull();
  });
  it('accepts empty page', () => expect(parseWith(PageResult, page([]))).toEqual({ questions: [] }));
});

describe('normalizeToSyllabus', () => {
  it('keeps exact match (case-insensitive, canonical spelling)', () => {
    const [r] = normalizeToSyllabus([item({ topic: 'cholinergic DRUGS' })], syl);
    expect(r).toMatchObject({ unit: 1, topic: 'Cholinergic drugs', confidence: 0.9 });
  });
  it('nulls unknown topic and caps confidence', () => {
    const [r] = normalizeToSyllabus([item({ topic: 'Made up topic' })], syl);
    expect(r.topic).toBeNull();
    expect(r.confidence).toBeLessThanOrEqual(0.3);
  });
  it('fixes unit from topic but flags it', () => {
    const [r] = normalizeToSyllabus([item({ unit: 1, topic: 'Antihypertensives' })], syl);
    expect(r.unit).toBe(2);
    expect(r.confidence).toBeLessThanOrEqual(0.5);
  });
  it('null unit always low confidence', () => {
    const [r] = normalizeToSyllabus([item({ unit: null, topic: null, confidence: 0.95 })], syl);
    expect(r.confidence).toBeLessThanOrEqual(0.3);
  });
});

describe('groups', () => {
  const qs = [1, 2, 3].map((id) => ({ id, text: `q${id}`, unit: 1, topic: null, marks: 5 }));
  it('validates shape', () => {
    expect(parseWith(GroupResult, JSON.stringify({ groups: [{ canonical_text: 'x', question_ids: [1] }] }))).not.toBeNull();
    expect(parseWith(GroupResult, JSON.stringify({ groups: [{ canonical_text: 'x', question_ids: [] }] }))).toBeNull();
  });
  it('dedupes ids, drops unknown, adds missing as singletons', () => {
    const r = sanitizeGroups({ groups: [{ canonical_text: 'A', question_ids: [1, 2, 99] }, { canonical_text: 'B', question_ids: [2] }] }, qs);
    expect(r.groups).toEqual([
      { canonical_text: 'A', question_ids: [1, 2] },
      { canonical_text: 'q3', question_ids: [3] },
    ]);
  });
});

it('toBase64 matches Buffer', () => {
  const b = new Uint8Array(70000).map((_, i) => i % 256);
  expect(toBase64(b)).toBe(Buffer.from(b).toString('base64'));
});
