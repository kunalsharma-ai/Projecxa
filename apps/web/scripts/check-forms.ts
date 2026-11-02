import { checkField, emptyValue, initialValues, readDay, validateAll, visibleValues, type FieldDef, type FormSchema } from '../lib/form-rules.ts';
import { emailDomain, hostOf, suggestCode } from '../lib/suggest.ts';

let failed = 0;
function eq(name: string, got: unknown, want: unknown) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  if (a !== b) { failed++; console.log(`✗ ${name}\n    got  ${a}\n    want ${b}`); }
}

// Field rules
const f = (d: Partial<FieldDef>): FieldDef => ({ name: 'x', type: 'text', label: 'X', ...d });
eq('required text', checkField(f({ required: true }), '  ', {}), 'This is required.');
eq('optional empty', checkField(f({ minLength: 3 }), '', {}), null);
eq('required select', checkField(f({ type: 'select', required: true }), null, {}), 'Please choose one.');
eq('required multi', checkField(f({ type: 'countries', required: true }), [], {}), 'Please choose at least one.');
eq('required by rule', checkField(f({ required: (v) => v.kind === 'B2B' }), '', { kind: 'B2B' }), 'This is required.');
eq('not required by rule', checkField(f({ required: (v) => v.kind === 'B2B' }), '', { kind: 'B2C' }), null);
eq('email', checkField(f({ type: 'email' }), 'nope@x', {}), 'Enter an email address like name@company.com.');
eq('email ok', checkField(f({ type: 'email' }), 'a@b.co', {}), null);
eq('url scheme', checkField(f({ type: 'url' }), 'ftp://x.com', {}), 'Enter a full link starting with https://');
eq('url macros ok', checkField(f({ type: 'url' }), 'https://cb.example.com/s?uid={uid}', {}), null);
eq('integer', checkField(f({ type: 'number', integer: true }), '2.5', {}), 'Enter a whole number.');
eq('range', checkField(f({ type: 'number', min: 1, max: 90 }), '120', {}), 'Enter 90 or less.');
eq('pattern', checkField(f({ pattern: [/^[A-Z]{2,4}$/, 'Bad code'] }), 'abcde', {}), 'Bad code');
eq('max items', checkField(f({ type: 'tags', max: 2 }), ['a', 'b', 'c'], {}), 'Choose no more than 2.');
eq('range end', checkField(f({ type: 'daterange', required: true }), { from: '2026-11-01', to: null }, {}), 'Choose the end date.');
eq('switch required', checkField(f({ type: 'switch', required: true }), false, {}), 'Please turn this on to continue.');
eq('custom validate', checkField(f({ validate: (v) => (v === 'taken' ? 'Already used' : null) }), 'taken', {}), 'Already used');

// Whole form: show-if, groups, submitted values
const schema: FormSchema = {
  sections: [
    { fields: [{ name: 'kind', type: 'segmented', label: 'Kind', options: [{ value: 'B2C', label: 'B2C' }, { value: 'B2B', label: 'B2B' }] }, { name: 'roles', type: 'checkboxes', label: 'Roles', required: true, showIf: (v) => v.kind === 'B2B' }, { name: 'n', type: 'number', label: 'N' }] },
    { fields: [{ name: 'contacts', type: 'group', label: 'Contacts', minItems: 1, fields: [{ name: 'name', type: 'text', label: 'Name', required: true }, { name: 'email', type: 'email', label: 'Email' }] }] },
    { showIf: (v) => v.kind === 'B2B', fields: [{ name: 'vat', type: 'text', label: 'VAT', required: true }] },
  ],
};
const init = initialValues(schema, { contacts: [] });
eq('initial', init, { kind: 'B2C', roles: [], n: '', contacts: [], vat: '' });
eq('errors b2c', validateAll(schema, init), { contacts: 'Add at least 1.' });
const b2b = { ...init, kind: 'B2B', contacts: [{ name: ' Ann ', email: 'bad' }] };
eq('errors b2b', validateAll(schema, b2b), { roles: 'Please choose at least one.', 'contacts.0.email': 'Enter an email address like name@company.com.', vat: 'This is required.' });
eq('visible b2c', visibleValues(schema, { ...init, n: '12', roles: ['x'], vat: 'GB1', contacts: [{ name: ' Ann ', email: '' }] }), { kind: 'B2C', n: 12, contacts: [{ name: 'Ann', email: '' }] });
eq('group starts with minItems', initialValues(schema).contacts, [{ name: '', email: '' }]);
eq('empty values', ['tags', 'daterange', 'switch', 'select'].map((t) => emptyValue(f({ type: t as FieldDef['type'] }))), [[], { from: null, to: null }, false, null]);

// Typed dates
const today = new Date(2026, 10, 2);
eq('today', readDay('today', today), '2026-11-02');
eq('tomorrow', readDay('Tomorrow', today), '2026-11-03');
eq('+7', readDay('+7', today), '2026-11-09');
eq('+2w', readDay('+2w', today), '2026-11-16');
eq('-3 days', readDay('-3 days', today), '2026-10-30');
eq('iso', readDay('2026-12-31', today), '2026-12-31');
eq('dmy', readDay('30/11/2026', today), '2026-11-30');
eq('bad day', readDay('31/02/2026', today), null);
eq('words', readDay('5 Jan 2027', today), '2027-01-05');
eq('nonsense', readDay('soon', today), null);

// Suggestions
eq('code initials', suggestCode('Harbour Light Research Ltd'), 'HLR');
eq('code one word', suggestCode('Kantar'), 'KANT');
eq('code taken', suggestCode('Acme Insights', ['AI', 'ai2']), 'AI3');
eq('code accents', suggestCode('Études Ödeme'), 'EO');
eq('code empty', suggestCode('Ltd'), null);
eq('host', hostOf('https://cb.Panel.example.com/s2s?uid={uid}'), 'cb.panel.example.com');
eq('host bad', hostOf('not a url'), null);
eq('email domain', emailDomain('maria@cobalt-analytics.com'), 'cobalt-analytics.com');
eq('free mail', emailDomain('someone@gmail.com'), null);

if (failed) { console.error(`${failed} smart form checks failed`); process.exit(1); }
console.log('All smart form checks pass');
