import { readFileSync } from 'node:fs';
import { columnIndex, columnName, readXlsx, rowsToObjects, writeXlsx } from '../lib/xlsx.ts';
import { maskEmail, maskPhone } from '../lib/mask.ts';

/** Checks the built-in Excel reader/writer (lib/xlsx.ts) and contact masking (lib/mask.ts). */
let failed = 0;
function ok(name: string, cond: boolean, got?: unknown) {
  if (!cond) { failed++; console.log(`✗ ${name}${got !== undefined ? ` (got ${JSON.stringify(got)})` : ''}`); }
}

ok('column A', columnIndex('A') === 0);
ok('column AA', columnIndex('AA') === 26);
ok('column names round trip', [0, 25, 26, 51, 52, 701, 702].every((i) => columnIndex(columnName(i)) === i));

// Our own template opens again with the same text, including XML-special and non-Latin characters.
const rows = [['name', 'code', 'website'], ['Acme & Sons <Ltd>', 'ACME', ''], ['Zoë "quoted"', '', 'https://x.example.com/?a=1&b=2'], ['日本語', '=1+1', '']];
const back = await readXlsx(writeXlsx(rows, 'Clients'));
ok('writer → reader round trip', JSON.stringify(back) === JSON.stringify(rows), back);

// A file saved by Excel-compatible software (deflate, shared strings, numbers, blank cells, empty rows, two sheets).
const excel = await readXlsx(readFileSync(new URL('./fixtures/clients-excel.xlsx', import.meta.url)));
ok('reads header', excel[0]?.join('|') === 'name|code|website|contact_name|contact_email', excel[0]);
ok('reads shared strings with & and <>', excel[1]?.[0] === 'Acme & Sons' && excel[2]?.[0] === 'Bright <Insights>', excel.slice(1, 3));
ok('keeps blank cells in place', excel[2]?.[1] === '' && excel[2]?.[2] === 'bright.example.com', excel[2]);
ok('drops empty rows, reads numbers and accents', excel.length === 4 && excel[3]?.[0] === 'Café Ünïcode' && excel[3]?.[1] === '42', excel[3]);
const objs = rowsToObjects(excel);
ok('rows to objects', objs[0]?.contact_email === 'pat@acme.com' && objs.length === 3, objs[0]);

let threw = false;
try { await readXlsx(new TextEncoder().encode('name,code\nA,B')); } catch { threw = true; }
ok('a CSV is not taken for an Excel file', threw);

// Masking keeps the domain and hides most of the name.
ok('mask email', maskEmail('pat.lee@aceresearch.com') === 'p•••••e@aceresearch.com', maskEmail('pat.lee@aceresearch.com'));
ok('mask short email', maskEmail('jo@acme.com') === 'j•@acme.com', maskEmail('jo@acme.com'));
ok('mask one letter', maskEmail('a@b.co') === '•@b.co', maskEmail('a@b.co'));
ok('mask non-email', maskEmail('nonsense') === '••••••••', maskEmail('nonsense'));
ok('mask phone', maskPhone('+44 20 7946 0123') === '+44 •• •••• 0123', maskPhone('+44 20 7946 0123'));

if (failed) {
  console.log(`${failed} xlsx/mask check(s) failed`);
  process.exit(1);
}
console.log('xlsx and masking: all checks passed');
