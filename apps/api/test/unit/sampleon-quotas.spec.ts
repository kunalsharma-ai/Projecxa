import { matchValue, suggestAttribute, translateCells, type AttributeDef } from '../../src/sampleon/quota-translate';
import type { Question } from '../../src/survey/questions';

const CATALOGUE: AttributeDef[] = [
  { key: 'hcp.specialty', label: 'Medical specialty', type: 'enum', values: ['cardiology', 'oncology', 'general_practice'], synonyms: { general_practice: ['GP', 'family medicine'] } },
  { key: 'b2b.years_experience', label: 'Years of professional experience', type: 'number' },
  { key: 'panelist.gender', label: 'Gender', type: 'enum', values: ['female', 'male'] },
  { key: 'health.diabetes', label: 'Has diabetes', type: 'boolean' },
];

const q = (id: string, type: Question['type'], text: string, options?: [string, string][]): Question =>
  ({ id, type, text, required: true, validation: {}, ...(options ? { options: options.map(([oid, label]) => ({ id: oid, label, action: 'accept' as const })) } : {}) }) as Question;

const GATE = [
  q('spec', 'single', 'What is your medical specialty?', [['card', 'Cardiology'], ['onc', 'Oncology'], ['gp', 'Family medicine'], ['oth', 'Something else']]),
  q('yrs', 'number', 'How many years of experience do you have?'),
];
const PRESCREEN = [q('dia', 'single', 'Have you been diagnosed with diabetes?', [['y', 'Yes'], ['n', 'No']])];

const cell = (id: string, country: string, conditions: unknown[], over: Partial<{ target: number; isOpen: boolean; group: string }> = {}) =>
  ({ id, name: id, group: over.group ?? '', target: over.target ?? 10, isOpen: over.isOpen ?? true, country, conditions });

describe('SampTrek quota cells → SAMPLEON quotas', () => {
  it('matches answer labels to attribute values, synonyms and yes/no', () => {
    expect(matchValue(CATALOGUE[0], 'Cardiology')).toBe('cardiology');
    expect(matchValue(CATALOGUE[0], 'family  medicine')).toBe('general_practice');
    expect(matchValue(CATALOGUE[0], 'Dentistry')).toBeNull();
    expect(matchValue(CATALOGUE[3], 'Yes')).toBe(true);
    expect(matchValue(CATALOGUE[3], 'No')).toBe(false);
  });

  it('suggests an attribute of the right type from the question', () => {
    expect(suggestAttribute(GATE[0], CATALOGUE)?.key).toBe('hcp.specialty');
    expect(suggestAttribute(GATE[1], CATALOGUE)?.key).toBe('b2b.years_experience');
  });

  it('sends nothing until a person confirms the question map, and says why', () => {
    const t = translateCells({ cells: [cell('c1', 'US', [{ source: 'gate', questionId: 'spec', values: ['card'] }])], gate: GATE, prescreen: [], catalogue: CATALOGUE, map: {} });
    expect(t.quotas).toEqual([]);
    expect(t.skipped[0].reason).toMatch(/Map “What is your medical specialty\?”/);
    expect(t.questions[0]).toMatchObject({ key: 'gate:spec', attribute: 'hcp.specialty', suggested: true });
  });

  it('translates choice, range and boolean conditions, interlocked', () => {
    const t = translateCells({
      cells: [
        cell('c1', 'US', [{ source: 'gate', questionId: 'spec', values: ['card', 'gp'] }, { source: 'gate', questionId: 'yrs', min: 5, max: 20 }], { group: 'Specialty x tenure', target: 40 }),
        cell('c2', 'US', [{ source: 'gate', questionId: 'yrs', min: 10 }]),
        cell('c3', 'US', [{ source: 'prescreen', questionId: 'dia', values: ['y'] }]),
      ],
      gate: GATE, prescreen: PRESCREEN, catalogue: CATALOGUE,
      map: { 'gate:spec': { attribute: 'hcp.specialty', values: {} }, 'gate:yrs': { attribute: 'b2b.years_experience', values: {} }, 'prescreen:dia': { attribute: 'health.diabetes', values: {} } },
    });
    expect(t.skipped).toEqual([]);
    expect(t.quotas).toEqual([
      { id: 'pjx-c1', label: 'Specialty x tenure: c1', country: 'US', target: 40, hard: true, conditions: [
        { attribute: 'hcp.specialty', op: 'in', values: ['cardiology', 'general_practice'] },
        { attribute: 'b2b.years_experience', op: 'between', min: 5, max: 20 },
      ] },
      { id: 'pjx-c2', label: 'c2', country: 'US', target: 10, hard: true, conditions: [{ attribute: 'b2b.years_experience', op: 'gte', value: 10 }] },
      { id: 'pjx-c3', label: 'c3', country: 'US', target: 10, hard: true, conditions: [{ attribute: 'health.diabetes', op: 'in', values: [true] }] },
    ]);
  });

  it('uses saved answer values, and skips device, closed, unmapped-answer and wrong-type cells', () => {
    const t = translateCells({
      cells: [
        cell('ok', 'US', [{ source: 'gate', questionId: 'spec', values: ['oth'] }]),
        cell('dev', 'US', [{ source: 'device', values: ['mobile'] }]),
        cell('closed', 'US', [{ source: 'gate', questionId: 'spec', values: ['card'] }], { isOpen: false }),
        cell('gone', 'US', [{ source: 'gate', questionId: 'removed', values: ['x'] }]),
      ],
      gate: GATE, prescreen: [], catalogue: CATALOGUE,
      map: { 'gate:spec': { attribute: 'hcp.specialty', values: { oth: 'oncology' } } },
    });
    expect(t.quotas.map((x) => x.id)).toEqual(['pjx-ok']);
    expect(t.quotas[0].conditions).toEqual([{ attribute: 'hcp.specialty', op: 'in', values: ['oncology'] }]);
    expect(Object.fromEntries(t.skipped.map((s) => [s.cellId, s.reason]))).toEqual({
      dev: 'Device is only known when the respondent opens the survey',
      closed: 'The cell is closed in SampTrek',
      gone: 'Question removed is no longer in the gate survey',
    });

    const wrong = translateCells({ cells: [cell('n', 'US', [{ source: 'gate', questionId: 'yrs', min: 3 }])], gate: GATE, prescreen: [], catalogue: CATALOGUE, map: { 'gate:yrs': { attribute: 'panelist.gender', values: {} } } });
    expect(wrong.skipped[0].reason).toBe('Gender is not a number');
    const unmapped = translateCells({ cells: [cell('u', 'US', [{ source: 'gate', questionId: 'spec', values: ['oth'] }])], gate: GATE, prescreen: [], catalogue: CATALOGUE, map: { 'gate:spec': { attribute: 'hcp.specialty', values: {} } } });
    expect(unmapped.skipped[0].reason).toBe('Map the answer “Something else” to a value of Medical specialty');
  });

  it('adds up the language versions of one market', () => {
    const cond = [{ source: 'gate', questionId: 'spec', values: ['card'] }];
    const t = translateCells({
      cells: [cell('en', 'CA', cond, { target: 30 }), cell('fr', 'CA', cond, { target: 20 }), cell('us', 'US', cond, { target: 5 })],
      gate: GATE, prescreen: [], catalogue: CATALOGUE, map: { 'gate:spec': { attribute: 'hcp.specialty', values: {} } },
    });
    expect(t.quotas.map((x) => [x.id, x.country, x.target])).toEqual([['pjx-en', 'CA', 50], ['pjx-us', 'US', 5]]);
  });
});
