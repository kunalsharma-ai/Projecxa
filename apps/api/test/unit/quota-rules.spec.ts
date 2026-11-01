import { cellInputSchema, cellMatches, conditionMatches, matchCells, needsAnswers, validateCells } from '../../src/quotas/quota.rules';
import type { Question } from '../../src/survey/questions';

const r = (device: string | null, gate: Record<string, unknown> = {}, prescreen: Record<string, unknown> = {}) => ({
  device,
  answers: {
    gate: Object.fromEntries(Object.entries(gate).map(([k, value]) => [k, { value }])),
    prescreen: Object.fromEntries(Object.entries(prescreen).map(([k, value]) => [k, { value }])),
  },
});

describe('quota rules', () => {
  it('matches device, choice, multi and number conditions', () => {
    expect(conditionMatches({ source: 'device', values: ['mobile', 'tablet'] }, r('mobile'))).toBe(true);
    expect(conditionMatches({ source: 'device', values: ['mobile'] }, r('desktop'))).toBe(false);
    expect(conditionMatches({ source: 'gate', questionId: 'gender', values: ['f'] }, r(null, { gender: 'f' }))).toBe(true);
    expect(conditionMatches({ source: 'gate', questionId: 'brands', values: ['c', 'b'] }, r(null, { brands: ['a', 'b'] }))).toBe(true);
    expect(conditionMatches({ source: 'gate', questionId: 'brands', values: ['c'] }, r(null, { brands: ['a', 'b'] }))).toBe(false);
    expect(conditionMatches({ source: 'gate', questionId: 'age', min: 18, max: 34 }, r(null, { age: 34 }))).toBe(true);
    expect(conditionMatches({ source: 'gate', questionId: 'age', min: 35 }, r(null, { age: 34 }))).toBe(false);
    expect(conditionMatches({ source: 'prescreen', questionId: 'pet', values: ['yes'] }, r(null, { pet: 'yes' }))).toBe(false);
    expect(conditionMatches({ source: 'prescreen', questionId: 'pet', values: ['yes'] }, r(null, {}, { pet: 'yes' }))).toBe(true);
  });

  it('a cell needs every condition, so cells can interlock', () => {
    const cell = { conditions: [{ source: 'gate', questionId: 'gender', values: ['f'] }, { source: 'gate', questionId: 'age', min: 18, max: 34 }] };
    expect(cellMatches(cell, r(null, { gender: 'f', age: 20 }))).toBe(true);
    expect(cellMatches(cell, r(null, { gender: 'f', age: 40 }))).toBe(false);
    expect(cellMatches(cell, r(null, { gender: 'f' }))).toBe(false);
    expect(cellMatches({ conditions: [] }, r('desktop'))).toBe(false);
    expect(cellMatches({ conditions: 'garbage' }, r('desktop'))).toBe(false);
    expect(needsAnswers(cell)).toBe(true);
    expect(needsAnswers({ conditions: [{ source: 'device', values: ['mobile'] }] })).toBe(false);
  });

  it('reports the first full or closed cell the respondent matches', () => {
    const base = { conditions: [{ source: 'gate', questionId: 'gender', values: ['f'] }], isOpen: true };
    const cells = [
      { ...base, id: 'f', target: 10, completes: 4 },
      { id: 'm', conditions: [{ source: 'gate', questionId: 'gender', values: ['m'] }], target: 10, completes: 10, isOpen: true },
      { id: 'mob', conditions: [{ source: 'device', values: ['mobile'] }], target: 10, completes: 0, isOpen: false },
    ];
    expect(matchCells(cells, r('desktop', { gender: 'f' }))).toMatchObject({ matched: [{ id: 'f' }], full: null });
    expect(matchCells(cells, r('desktop', { gender: 'm' })).full?.id).toBe('m');
    expect(matchCells(cells, r('mobile', { gender: 'f' })).full?.id).toBe('mob');
    expect(matchCells(cells, r('desktop', {})).matched).toEqual([]);
  });

  it('validates cell input and checks it against the questions', () => {
    expect(cellInputSchema.safeParse({ name: 'A', target: 5, conditions: [] }).success).toBe(false);
    expect(cellInputSchema.safeParse({ name: 'A', target: 5, conditions: [{ source: 'device', values: ['fridge'] }] }).success).toBe(false);
    expect(cellInputSchema.safeParse({ name: 'A', target: 5, conditions: [{ source: 'gate', values: ['x'] }] }).success).toBe(false);
    expect(cellInputSchema.safeParse({ name: 'A', target: 5, conditions: [{ source: 'gate', questionId: 'age', min: 40, max: 30 }] }).success).toBe(false);
    const ok = cellInputSchema.parse({ name: 'Young women', target: 5, conditions: [{ source: 'gate', questionId: 'age', min: 18, max: 34 }, { source: 'gate', questionId: 'gender', values: ['f'] }] });
    expect(ok).toMatchObject({ group: '', isOpen: true });

    const gate = [
      { id: 'age', type: 'number', text: 'Age', required: true },
      { id: 'gender', type: 'single', text: 'Gender', required: true, options: [{ id: 'm', label: 'M', action: 'accept' }, { id: 'f', label: 'F', action: 'accept' }] },
      { id: 'zip', type: 'text', text: 'ZIP', required: true },
    ] as Question[];
    expect(validateCells([ok], { gate, prescreen: [] })).toEqual([]);
    const issues = validateCells(
      [
        cellInputSchema.parse({ name: 'A', target: 1, conditions: [{ source: 'gate', questionId: 'zip', values: ['1'] }] }),
        cellInputSchema.parse({ name: 'B', target: 1, conditions: [{ source: 'prescreen', questionId: 'gender', values: ['f'] }] }),
        cellInputSchema.parse({ name: 'C', target: 1, conditions: [{ source: 'gate', questionId: 'gender', values: ['q'] }] }),
        cellInputSchema.parse({ name: 'D', target: 1, conditions: [{ source: 'gate', questionId: 'age', values: ['30'] }] }),
      ],
      { gate, prescreen: [] },
    );
    expect(issues).toEqual([
      'A: zip is a text question; quotas need a choice or number question',
      'B: question gender is not in the prescreener',
      'C: gender has no option q',
      'D: use a range for the number question age',
    ]);
  });
});
