// evidence.test.mjs — the finding has to be TRUE, not merely present.
//
// Every test in this file exists because a mutation gate changed a line and nothing failed. The
// pattern in all of them is the same: the suite asserted that a finding was produced, and never that
// it said the right thing. Off-by-one a line number, flip a fallback, drop a tie-break, and the tool
// still reports the same number of findings — each one now pointing somewhere else.
//
// A finding nobody can act on is worse than no finding, because it looks actionable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { assess } from '../assessor.mjs';
import { CLEAN } from './fixture.mjs';
import { fixtures } from './helpers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'assessor.mjs');
const { mk, scan } = fixtures();
const TAG = 'TO' + 'DO';

// three blank-ish leading lines so a reported line number can only be right by being computed
const LEAD = ['export const a = 1;', '', 'export const b = 2;', ''];

test('⚑ an abandoned marker is reported at the line it is on', () => {
  const ev = scan({ ...CLEAN, 'src/marked.mjs': [...LEAD, `// ${TAG}: finish this`, 'export const c = 3;'].join('\n') });
  assert.equal(ev.todos.length, 1, 'one marker');
  assert.equal(ev.todos[0].line, 5,
    '⚑ line 5, counted from one. An index into the array is not a line number, and a finding at the wrong line sends the reader to unrelated code');
  assert.equal(ev.todos[0].file, 'src/marked.mjs', 'in the file that carries it');
  assert.match(ev.todos[0].text, new RegExp(TAG), 'quoted back, so the reader recognises it on arrival');
});

test('⚑ a disabled test is reported at the line it is on', () => {
  const sk = 'sk' + 'ip';
  const ev = scan({
    ...CLEAN,
    'tests/index.test.mjs': ["import test from 'node:test';", "import { v1 } from '../src/index.mjs';", '',
      `test.${sk}('not run', () => { v1; });`].join('\n'),
  });
  assert.equal(ev.skips.length, 1);
  assert.equal(ev.skips[0].line, 4, 'the fourth line, not the fourth index');
});

test('⚑ a defect marker is reported at the line it is on', () => {
  const ev = scan({ ...CLEAN, 'src/marked.mjs': [...LEAD, '// BROKEN: it does not work', 'export const c = 3;'].join('\n') });
  assert.equal(ev.defectMarkers.length, 1);
  assert.equal(ev.defectMarkers[0].line, 5, 'the fifth line');
});

test('⚑ a repeated EIGHT-line block is reported at the line it starts on', () => {
  // The two-line scan has this covered; the eight-line one carries its own copy of the arithmetic,
  // and a second copy of a rule is a second place for it to be wrong.
  const pad = Array.from({ length: 6 }, (_, i) => `// a header comment ${i}`).join('\n');
  const block = Array.from({ length: 8 }, (_, i) => `const configuration${i} = { retries: ${i}, timeout: 1000 };`).join('\n');
  const ev = scan({
    ...CLEAN,
    'src/a.mjs': `${pad}\n${block}\nexport const a = 1;`,
    'src/b.mjs': `${pad}\n${block}\nexport const b = 2;`,
  });
  const hit = ev.longDupes.find(d => d.count >= 2);
  assert.ok(hit, 'precondition: the eight-line block is found in both files');
  for (const at of hit.at) assert.equal(at.line, 7,
    '⚑ the block starts on line 7 — six comment lines above it are skipped for hashing but they still occupy lines in the file');
});

test('⚑ a decision record with a Status HEADING is read from under the heading', () => {
  // The heading form and the inline form must agree. Reading the line BEFORE the heading instead of
  // after it picks up the heading itself, which is never a placeholder — so an unfinished decision
  // silently passes.
  const unfinished = scan({ ...CLEAN, 'docs/adr/0001-choose.md': '# Choose\n\n## Status\n\nTBD\n\nWe chose.\n' });
  assert.equal(unfinished.adrBad.length, 1, 'a placeholder under the heading is still a placeholder');
  assert.match(unfinished.adrBad[0].text, /TBD/, 'and it is quoted back, so the finding can be argued with');

  const finished = scan({ ...CLEAN, 'docs/adr/0001-choose.md': '# Choose\n\n## Status\n\nAccepted\n\nWe chose.\n' });
  assert.equal(finished.adrBad.length, 0, 'while a real status under the heading is accepted');
});

test('⚑ a Status heading with nothing under it is blank, not missing', () => {
  // Two different repositories, two different fixes: one forgot to fill the section in, the other
  // has no section at all. The report has to tell them apart.
  const blank = scan({ ...CLEAN, 'docs/adr/0001-choose.md': '# Choose\n\nWe chose.\n\n## Status\n' });
  assert.equal(blank.adrBad.length, 1);
  assert.match(blank.adrBad[0].text, /\(blank\)/,
    '⚑ the heading exists and is empty — reporting that as "(missing)" would send the author looking for a section that is already there');

  const missing = scan({ ...CLEAN, 'docs/adr/0001-choose.md': '# Choose\n\nWe chose.\n' });
  assert.match(missing.adrBad[0].text, /\(missing\)/, 'while a record with no Status at all is missing one');
});

test('⚑ a build output is recognised wherever the flag sits in the script', () => {
  const pkg = (scripts) => JSON.stringify({
    name: 'f', type: 'module', description: 'a real description', author: 'A Real Person',
    main: './src/index.mjs', scripts: { test: 'node --test tests/index.test.mjs', ...scripts },
  }, null, 2);

  const middle = scan({ ...CLEAN, 'package.json': pkg({ build: 'esbuild src/index.mjs --outfile dist/out.js' }) });
  assert.ok(middle.buildOutputs.has('dist/out.js'), 'named after a flag in the middle of the command');

  const first = scan({ ...CLEAN, 'package.json': pkg({ build: '> dist/out.js' }) });
  assert.ok(first.buildOutputs.has('dist/out.js'),
    '⚑ and when the flag is the very first token — the guard must look at what FOLLOWS the flag, and a guard reading the preceding token is only ever right by accident');
});

test('⚑ a placeholder identity is caught by EITHER the name or the email', () => {
  // An unconfigured git leaves both. A half-configured one leaves one, and that is the case worth
  // catching: requiring both would let every partially-configured repository through.
  const byName = assess(mk(CLEAN, { git: true, author: { name: 'Your Name', email: 'real.person@company.com' } })).verdict;
  assert.equal(byName.results.find(r => r.id === 'ACC-05').verdict, 'NOT_MET',
    '⚑ a real email does not excuse "Your Name" — the commit still records nobody');

  const byEmail = assess(mk(CLEAN, { git: true, author: { name: 'A Real Person', email: 'you@example.com' } })).verdict;
  assert.equal(byEmail.results.find(r => r.id === 'ACC-05').verdict, 'NOT_MET', 'and a real name does not excuse a template email');

  const real = assess(mk(CLEAN, { git: true, author: { name: 'A Real Person', email: 'real.person@company.com' } })).verdict;
  assert.equal(real.results.find(r => r.id === 'ACC-05').verdict, 'MET', 'while a properly configured author passes');
});

test('⚑ the dominant tell is the commonest failure, not the first one alphabetically', () => {
  // The tally is sorted by count, with the NAME only as a tie-break. Those two orderings have to be
  // kept apart: this repository fails three UNOPENED criteria and one COLLAPSED, so counting says
  // UNOPENED and the alphabet says COLLAPSED. A report that names the wrong dominant failure sends
  // the reader to fix the wrong thing, and it does it while looking perfectly confident.
  const files = { ...CLEAN, 'README.md': '# A tool\n\nIt does a real thing. See [the guide](docs/nowhere.md).\n' };
  delete files['tests/index.test.mjs'];          // VER-01, VER-03 — UNOPENED
  delete files['.github/workflows/ci.yml'];      // VER-04           — UNOPENED
  const v = assess(mk(files, { git: true })).verdict;

  const entries = Object.entries(v.tellTally);
  assert.ok(entries.length >= 2, `precondition: more than one tell fails, saw ${JSON.stringify(v.tellTally)}`);
  assert.equal(v.tellTally.UNOPENED, 3, 'three unexercised-code failures');
  assert.equal(v.tellTally.COLLAPSED, 1, 'and one abandoned-subgoal failure');

  assert.equal(v.dominantTell, 'UNOPENED',
    '⚑ UNOPENED is three failures and COLLAPSED is one, but COLLAPSED sorts first alphabetically — the dominant tell must come from the count');
  assert.equal(v.tellTally[v.dominantTell], Math.max(...entries.map(e => e[1])), 'and it is always the largest count');

  const counts = entries.map(e => e[1]);
  assert.deepEqual(counts, [...counts].sort((a, b) => b - a), 'the whole tally is ordered commonest-first');

  const keys = entries.map(e => e[0]);
  for (let i = 1; i < keys.length; i++) {
    if (v.tellTally[keys[i]] === v.tellTally[keys[i - 1]]) assert.ok(keys[i - 1] < keys[i],
      `⚑ ${keys[i - 1]} and ${keys[i]} are tied, so the name breaks the tie — otherwise the order depends on which criterion happens to be declared first`);
  }
});

test('⚑ every kind of link that leaves the repository is left alone', () => {
  // SPEC-03 asks that relative links resolve to a path in the repository. A link that was never
  // pointing at a path in the repository is not a broken one — and each of these forms is recognised
  // by a different clause, so each needs its own case or a clause can be broken with nothing failing.
  const links = [
    '[web](https://example.com/page)',
    '[insecure](http://example.com/page)',
    '[mail](mailto:someone@example.com)',
    '[phone](tel:+441234567890)',
    '[anchor](#a-heading-on-this-page)',
    '[scheme](ftp://files.example.com/thing.zip)',
    '[protocol-relative](//cdn.example.com/lib.js)',
  ];
  const v = assess(mk({ ...CLEAN, 'README.md': `# A tool\n\nIt does a real thing.\n\n${links.join('\n\n')}\n` })).verdict;
  const spec03 = v.results.find(r => r.id === 'SPEC-03');
  assert.equal(spec03.verdict, 'MET',
    `⚑ none of these is a path this repository could contain — reporting them as dead links would make every README with a mailto or a CDN reference fail. Evidence said: ${spec03.evidence}`);
});

test('and a relative link that really is dead is still caught, and named', () => {
  // Read from assess().results rather than verdict.results: the published verdict carries the
  // evidence sentence, the full result carries the sample that names each offending target.
  const { results } = assess(mk({ ...CLEAN, 'README.md': '# A tool\n\nIt does a real thing. See [the guide](docs/nowhere.md).\n' }));
  const spec03 = results.find(r => r.id === 'SPEC-03');
  assert.equal(spec03.verdict, 'NOT_MET', 'the guard must not have been widened into an excuse for everything');
  assert.match(JSON.stringify(spec03.sample || []), /nowhere\.md/,
    'and the dead target is named — "a link is broken" without saying which one is not a finding anybody can act on');
});

test('a link with an anchor or a query resolves on the path part', () => {
  const v = assess(mk({
    ...CLEAN,
    'README.md': '# A tool\n\nIt does a real thing. See [design](docs/design.md#the-middle) and [again](docs/design.md?plain=1).\n',
  })).verdict;
  assert.equal(v.results.find(r => r.id === 'SPEC-03').verdict, 'MET',
    'the fragment and the query are not part of the filename, and a repository should not fail for deep-linking its own documentation');
});

// Memoised for the same reason as in verdict.test.mjs: the same command is asked several questions,
// and this tool's whole claim is that the same input gives the same output.
const cliCache = new Map();
const runCLI = (dir, args = []) => {
  const key = JSON.stringify([dir, args]);
  if (!cliCache.has(key)) {
    let out;
    try { out = execFileSync(process.execPath, [CLI, dir, ...args], { encoding: 'utf8' }); }
    catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
    cliCache.set(key, out.replace(/\x1b\[[0-9;]*m/g, ''));
  }
  return cliCache.get(key);
};

test('⚑ each verdict prints as its own mark, and the marks are distinct', () => {
  // The reader scans the left column. If two of the three verdicts render alike, a failure and a
  // not-applicable look the same at a glance, and the report is worse than a bare number.
  const files = { ...CLEAN, 'package.json': CLEAN['package.json'].replace('"main": "./src/index.mjs"', '"main": "./src/gone.mjs"') };
  const { results } = assess(mk(files));
  for (const want of ['MET', 'NOT_MET', 'N/A']) {
    assert.ok(results.some(r => r.verdict === want), `precondition: the fixture produces at least one ${want}`);
  }
  const plain = runCLI(mk(files));
  assert.match(plain, /\bMET\b/, 'a met criterion is marked met');
  assert.match(plain, /✗ FAIL/, 'a failed one is marked failed');
  assert.match(plain, /\bn\/a\b/, 'and a not-applicable one is marked n/a');

  const failLines = plain.split('\n').filter(l => /✗ FAIL/.test(l));
  const naLines = plain.split('\n').filter(l => /\bn\/a\b\s+[A-Z]{3,4}-\d\d/.test(l));
  assert.ok(failLines.length > 0 && naLines.length > 0, 'both appear on criterion lines');
  assert.equal(failLines.filter(l => /\bn\/a\b/.test(l)).length, 0,
    '⚑ and no line carries two marks — a failure rendered as anything but a failure is the whole problem this tool measures');

  // ⚑ Every criterion must carry ITS OWN verdict's mark. Checking only that all three marks appear
  // somewhere lets the marks be attached to the wrong criteria — the report stays colourful and
  // tells the reader the opposite of the truth about which rules this repository broke.
  const WANT = { MET: 'MET', NOT_MET: '✗ FAIL', 'N/A': 'n/a' };
  const lines = plain.split('\n');
  for (const r of results) {
    // Only a criterion line: it opens with the mark and then the id. Matching anywhere the id
    // appears picks up the n/a justification of a DIFFERENT criterion that happens to name it.
    const line = lines.find(l => new RegExp(`^\\s*(✗ FAIL|MET|n/a)\\s+${r.id}\\b`).test(l));
    assert.ok(line, `${r.id} has a line of its own in the report`);
    const mark = (line.match(/^\s*(✗ FAIL|MET|n\/a)/) || [])[1];
    assert.equal(mark, WANT[r.verdict],
      `${r.id} is ${r.verdict} and must be marked "${WANT[r.verdict]}", saw "${mark}"`);
  }
});

test('⚑ each domain heading is printed once, above its own criteria', () => {
  const plain = runCLI(mk(CLEAN));
  const { results } = assess(mk(CLEAN));
  for (const domain of new Set(results.map(r => r.domain))) {
    const heading = domain.toUpperCase();
    const count = plain.split('\n').filter(l => l.trim() === heading).length;
    assert.equal(count, 1,
      `⚑ "${heading}" appears ${count} times — a heading printed per criterion, or not at all, turns a grouped report into a flat list`);
  }
});

test('⚑ the core summary says all met only when they all are', () => {
  const good = runCLI(mk(CLEAN));
  assert.match(good, /core criteria\s+(\d+)\/\1\s+all met/, 'a repository meeting every core criterion is told so');
  assert.ok(!/not all met/.test(good), 'and not told the opposite in the same breath');

  const bad = runCLI(mk({ ...CLEAN, 'package.json': CLEAN['package.json'].replace('"main": "./src/index.mjs"', '"main": "./src/gone.mjs"') }));
  assert.match(bad, /core criteria\s+\d+\/\d+\s+not all met/,
    '⚑ and one short of the full set is "not all met" — this line is the one a reader checks first');
});

test('⚑ the report prints the finding, not the word undefined', () => {
  const dir = mk({ ...CLEAN, 'src/marked.mjs': [...LEAD, `// ${TAG}: finish this thing`, 'export const c = 3;'].join('\n') });
  let out;
  try { out = execFileSync(process.execPath, [CLI, dir], { encoding: 'utf8' }); }
  catch (e) { out = e.stdout || ''; }
  const plain = out.replace(/\x1b\[[0-9;]*m/g, '');

  assert.match(plain, /src\/marked\.mjs:5/, 'the sample names the file and the real line');
  assert.match(plain, /finish this thing/,
    '⚑ and quotes the line itself — a sample whose text fell back to nothing would still print a tidy-looking arrow and tell the reader nothing');
  assert.ok(!/undefined/.test(plain),
    '⚑ and nowhere in the report does the word "undefined" appear, which is what a broken fallback prints');
});


test('⚑ a NESTED fixture manifest never shadows the ROOT one', () => {
  // The walk is alphabetical, so fixtures/<x>/package.json sorts before package.json — and matching
  // the manifest by NAME handed the whole evidence block (deps, author, description, entrypoints)
  // to a test fixture. konomify failed its own core criterion, BND-03, on a path that belonged to
  // its fixture repo. A repository's wiring is the manifest at its ROOT, full stop.
  const ev = scan({
    ...CLEAN,
    'fixtures/repo/package.json': '{ "name": "fx", "main": "main.mjs", "author": "Nobody Fixture", "dependencies": { "left-pad": "1.0.0" } }',
    'fixtures/repo/main.mjs': 'export const x = 1;\n',
  });
  // the root CLEAN manifest wires ./src/index.mjs — the fixture's 'main.mjs' must not appear
  assert.ok(!ev.manifestRefs.includes('main.mjs'),
    'the fixture manifest was read as the repository manifest: refs = ' + ev.manifestRefs.join(', '));
  assert.ok(!ev.deps.includes('left-pad'), 'the fixture manifest supplied the dependency list');
  assert.notEqual(ev.pkgAuthor, 'Nobody Fixture', 'the fixture manifest supplied the author');
});
