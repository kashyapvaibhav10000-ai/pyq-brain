/**
 * Priority score for one question group.
 *
 *   score = Σ over each occurrence i of  marksWeight(marks_i) × RECENCY_DECAY ^ (latestYear − year_i)
 *
 *   marksWeight(m) = m / 5        (2-mark → 0.4, 5 → 1, 10 → 2; unknown marks → 1)
 *   RECENCY_DECAY  = 0.8          (asked last year counts 0.8, 3 years back ≈ 0.51, 6 years ≈ 0.26)
 *   latestYear     = newest paper year across the whole subject (so groups are comparable)
 *
 * Effect: a 10-mark question asked in each of the last 3 years ≫ a 2-mark question asked once long ago.
 * Rounded to 2 decimals. Change constants here only.
 */
export const RECENCY_DECAY = 0.8;

export type Occurrence = { year: number; marks: number | null };

export function marksWeight(marks: number | null): number {
  return marks && marks > 0 ? marks / 5 : 1;
}

export function priorityScore(occurrences: Occurrence[], latestYear: number): number {
  let s = 0;
  for (const o of occurrences) {
    const age = Math.max(0, latestYear - o.year);
    s += marksWeight(o.marks) * RECENCY_DECAY ** age;
  }
  return Math.round(s * 100) / 100;
}

export type Member = { paper_id: number; year: number; marks: number | null; unit: number | null; topic: string | null };

function mode<T>(xs: T[]): T | null {
  const counts = new Map<T, number>();
  let best: T | null = null;
  let bestN = 0;
  for (const x of xs) {
    if (x === null) continue;
    const n = (counts.get(x) ?? 0) + 1;
    counts.set(x, n);
    if (n > bestN) [best, bestN] = [x, n];
  }
  return best;
}

/**
 * Aggregate one group's member questions.
 * "Times asked" = distinct papers (an OR-choice repeat inside one paper counts once; its max marks used).
 * Unit/topic = most common non-null tag among members, so user fixes in Review flow into groups.
 */
export function groupStats(members: Member[], latestYear: number) {
  const perPaper = new Map<number, Occurrence>();
  for (const m of members) {
    const prev = perPaper.get(m.paper_id);
    if (!prev || (m.marks ?? 0) > (prev.marks ?? 0)) perPaper.set(m.paper_id, { year: m.year, marks: m.marks });
  }
  const occ = [...perPaper.values()];
  const marks = members.map((m) => m.marks).filter((m): m is number => m !== null);
  return {
    unit: mode(members.map((m) => m.unit)),
    topic: mode(members.map((m) => m.topic)),
    occurrence_count: occ.length,
    years: [...new Set(occ.map((o) => o.year))].sort((a, b) => a - b),
    max_marks: marks.length ? Math.max(...marks) : null,
    priority_score: priorityScore(occ, latestYear),
  };
}
