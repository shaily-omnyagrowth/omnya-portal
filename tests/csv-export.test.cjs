// tests/csv-export.test.cjs
//
// Scope spec §14: "Exports are permission-controlled, logged and protected
// against spreadsheet formula injection."
// Scope spec §15.1 lists CSV sanitization as a unit-test requirement.
//
// Only the quoting half was implemented: csvField() escaped double-quotes but
// left a leading = + - @ intact, and quoting does NOT disarm those — Excel
// evaluates `"=1+1"` on open.
//
// The values are attacker-supplied in the ordinary course of business. A
// creator sets their own name, payout_email and payment_handle, and all three
// land in the batch CSV an owner opens in Excel to make the payments.
//
//   node tests/csv-export.test.cjs

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
const R = (ok, label, detail) => {
  console.log('  ' + (ok ? 'PASS   ' : 'FAIL   ') + label + (detail ? '   ' + detail : ''));
  if (ok) pass++; else fail++;
};

// csvField is module-private. Rather than export it purely for the test — which
// changes the shipped surface to suit the harness — lift the two helpers out of
// the source and evaluate them. If they are ever renamed or removed this throws
// loudly instead of silently testing nothing.
function loadCsvHelpers() {
  const src = fs.readFileSync(path.join(ROOT, 'api/payouts/export.js'), 'utf8');
  const triggers = src.match(/const FORMULA_TRIGGERS = [^\n]+/);
  const field = src.match(/function csvField\(value\) \{[\s\S]*?\n\}/);
  const row = src.match(/function csvRow\(fields\) \{[\s\S]*?\n\}/);

  if (!field || !row) {
    throw new Error(
      'TEST BUG: could not find csvField/csvRow in api/payouts/export.js. ' +
      'They were renamed or removed — update this test rather than deleting it.'
    );
  }
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext([triggers ? triggers[0] : '', field[0], row[0]].join('\n'), ctx);
  return ctx;
}

const { csvField, csvRow } = loadCsvHelpers();

// The four leading characters a spreadsheet treats as "this is a formula",
// plus the two whitespace characters that can smuggle one past a naive check.
const PAYLOADS = [
  ['=1+1',                                  'equals'],
  ['+1+1',                                  'plus'],
  ['-1+1',                                  'minus'],
  ['@SUM(A1:A9)',                           'at'],
  ['\t=1+1',                                'tab then equals'],
  ['\r=1+1',                                'carriage return then equals'],
  ['=HYPERLINK("https://evil.example","x")', 'HYPERLINK exfiltration'],
  ["=cmd|'/c calc'!A1",                     'DDE command execution'],
];

console.log('\nCSV export — spreadsheet formula injection (scope spec §14)\n');

// The guard has to exist at all.
R(typeof csvField === 'function', 'csvField is present and testable');

for (const [payload, label] of PAYLOADS) {
  const out = csvField(payload);
  const inner = out.slice(1, -1);            // strip the wrapping quotes
  const neutralised = inner.startsWith("'");
  R(neutralised, `a cell beginning with ${label} is neutralised`,
    JSON.stringify(out.length > 34 ? out.slice(0, 34) + '…' : out));
}

// And it must not mangle ordinary data, which is how a "fix" like this gets
// reverted three months later.
const BENIGN = [
  ['Ada Lovelace',        'a normal name'],
  ['ada@example.com',     'an email address'],
  ['1250.00',             'an amount'],
  ['2026-08-22',          'a date'],
  ['O\'Brien',            'an apostrophe inside a name'],
  ['Smith, Jane',         'a comma inside a value'],
  ['He said "hi"',        'embedded double-quotes'],
  ['',                    'an empty value'],
];

console.log('');
for (const [value, label] of BENIGN) {
  const out = csvField(value);
  const inner = out.slice(1, -1);
  const expected = value.replace(/"/g, '""');
  R(inner === expected, `${label} is left alone`, JSON.stringify(out));
}

// Quoting still has to work, or a comma breaks the column alignment.
console.log('');
R(csvField('Smith, Jane') === '"Smith, Jane"', 'a comma stays inside one quoted cell');
R(csvField('He said "hi"') === '"He said ""hi"""', 'internal quotes are doubled');
R(csvField(null) === '""' && csvField(undefined) === '""', 'null and undefined become an empty cell');

const row = csvRow(['=1+1', 'Smith, Jane', 42]);
R(row.split('","').length === 3, 'csvRow joins three cells without breaking on the comma', row);
R(row.startsWith('"\'=1+1"'), 'and the neutralised cell survives the join', row.slice(0, 12));

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
