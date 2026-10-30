// tests/setup-sql.test.cjs
//
// supabase/SETUP.sql must contain what every migration creates.
//
//   node tests/setup-sql.test.cjs

const fs = require('fs');
const path = require('path');

const DB = path.join(__dirname, '..', 'supabase');
const setup = fs.readFileSync(path.join(DB, 'SETUP.sql'), 'utf8');
const probes = JSON.parse(fs.readFileSync(path.join(DB, 'migrations', 'probes.json'), 'utf8'));

const nameOf = (p) => p.trigger || p.policy || p.constraint || p.index || (p.signature && p.signature.split('(')[0]) || p.table;

let fail = 0;
console.log('\nSETUP.sql');
for (const [file, probe] of Object.entries(probes)) {
  if (probe.kind === 'manual' || probe.retiredBy) continue;
  const ok = setup.includes(nameOf(probe));
  console.log('  ' + (ok ? 'PASS   ' : 'FAIL   ') + file + '   ' + nameOf(probe));
  if (!ok) fail++;
}
console.log(`\n${fail} failed`);
process.exit(fail ? 1 : 0);
