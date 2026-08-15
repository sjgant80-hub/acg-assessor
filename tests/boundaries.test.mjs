// boundaries.test.mjs — the edges of every comparison the assessor makes.
//
// A criterion is a line somewhere. Move it by one and almost nothing changes: the clean repositories
// still pass, the bad ones still fail, and the only repositories affected are the ones sitting
// exactly on the line — which is precisely where a rubric has to be right, because that is where
// someone will argue with it.
//
// Every case here was written because a mutation gate moved a boundary and the suite did not notice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assess, gather } from '../assessor.mjs';
import { CLEAN } from './fixture.mjs';
import { fixtures } from './helpers.mjs';

const { mk, scan } = fixtures();
// assess().results, not verdict.results: the published verdict carries the evidence sentence, while
// the full result also carries the sample naming each offending item — which is what a finding is for.
//
// ⚑ No git by default. Building a repository with real history costs five git subprocesses, and only
// the provenance criteria read any of it — every case in this file except the tracked-file boundary
// is asking about something else entirely. Paying for history in all of them pushed the suite past
// the mutation gate's per-run timeout, at which point the gate cannot run at all.
const verdictOf = (id, files, opts = {}) => assess(mk(files, opts)).results.find(r => r.id === id);
const lines = (n, prefix = 'export const v') => Array.from({ length: n }, (_, i) => `${prefix}${i} = ${i};`).join('\n');

test('⚑ a test-to-source ratio exactly on the line is met', () => {
  // VER-03 asks for at least one test file per four source files. One-in-four IS one per four.
  const files = { ...CLEAN, 'tests/index.test.mjs': CLEAN['tests/index.test.mjs'] };
  for (let i = 0; i < 3; i++) files[`src/extra${i}.mjs`] = `export const e${i} = ${i};\n`;
  const r = verdictOf('VER-03', files);       // 1 test file, 4 source files
  assert.equal(r.verdict, 'MET',
    `⚑ exactly one per four meets "at least one per four" — a repository on the published line must not fail it. Evidence: ${r.evidence}`);
});

test('and one test short of the ratio is not', () => {
  const files = { ...CLEAN };
  for (let i = 0; i < 4; i++) files[`src/extra${i}.mjs`] = `export const e${i} = ${i};\n`;
  assert.equal(verdictOf('VER-03', files).verdict, 'NOT_MET', '1 test to 5 source files is below the line');
});

test('⚑ a codebase of exactly thirty lines is assessed, not excused', () => {
  // EVO-01 declines below thirty lines. Thirty is not below thirty.
  const files = { ...CLEAN, 'src/index.mjs': lines(29) + '\n' };
  delete files['tests/index.test.mjs'];       // keep the count to the one file we are controlling
  const ev = scan(files);
  assert.equal(ev.totalLines, 30, `precondition: exactly thirty lines, saw ${ev.totalLines}`);
  assert.notEqual(verdictOf('EVO-01', files).verdict, 'N/A',
    '⚑ "under 30 lines" excuses 29, not 30 — an off-by-one here silently exempts a whole band of small repositories from the duplication criterion');
});

test('a codebase of twenty-nine lines is excused', () => {
  const files = { ...CLEAN, 'src/index.mjs': lines(28) + '\n' };
  delete files['tests/index.test.mjs'];
  const ev = scan(files);
  assert.equal(ev.totalLines, 29, `precondition: twenty-nine lines, saw ${ev.totalLines}`);
  assert.equal(verdictOf('EVO-01', files).verdict, 'N/A', 'and it says so rather than passing it silently');
});

test('⚑ a repository of exactly four tracked files is big enough to expect history', () => {
  // PRV-03 declines a repository of three files or fewer as too small to expect more than one commit.
  const four = { 'README.md': '# A tool\n\nIt does a real thing, described at length.\n', 'LICENSE': 'MIT\n',
    'src/index.mjs': 'export const a = 1;\n', 'src/other.mjs': 'export const b = 2;\n' };
  const r = verdictOf('PRV-03', four, { git: true });
  assert.notEqual(r.verdict, 'N/A',
    `⚑ four tracked files is more than three, so the criterion applies. Evidence: ${r.evidence}`);

  const three = { 'README.md': '# A tool\n\nIt does a real thing.\n', 'LICENSE': 'MIT\n', 'src/index.mjs': 'export const a = 1;\n' };
  assert.equal(verdictOf('PRV-03', three, { git: true }).verdict, 'N/A', 'while three is genuinely too small to read anything into');
});

test('⚑ a line of thirteen characters is long enough to count as duplication', () => {
  // The duplication scan ignores lines of twelve characters or fewer, because `}` and `return` are
  // in every file. Thirteen is not twelve, and the cut has to fall somewhere defensible.
  const thirteen = 'const a = 1;;';               // exactly 13 characters
  assert.equal(thirteen.length, 13, 'precondition');
  const pair = `${thirteen}\n${thirteen.replace('a', 'b')}`;
  const ev = scan({ ...CLEAN, 'src/a.mjs': `${pair}\nexport const x = 1;`, 'src/b.mjs': `${pair}\nexport const y = 2;`, 'src/c.mjs': `${pair}\nexport const z = 3;` });
  assert.ok(ev.dupes.some(d => d.count >= 3),
    '⚑ thirteen-character lines repeated in three files are the signature this criterion looks for');
});

test('and a line of twelve characters is not', () => {
  const twelve = 'const a = 1;';                  // exactly 12
  assert.equal(twelve.length, 12, 'precondition');
  const pair = `${twelve}\n${twelve.replace('a', 'b')}`;
  const ev = scan({ ...CLEAN, 'src/a.mjs': `${pair}\nexport const x = 1;`, 'src/b.mjs': `${pair}\nexport const y = 2;`, 'src/c.mjs': `${pair}\nexport const z = 3;` });
  assert.equal(ev.dupes.filter(d => d.count > 2).length, 0, 'short lines are the same everywhere and prove nothing');
});

test('⚑ a duplicated pair at the very END of a file is still found', () => {
  // The window walks to `i + 2 <= length`. Stop one short and the last pair in every file is never
  // hashed — so duplication is invisible exactly where generated code tends to be appended.
  const pair = 'const configuration = { retries: 3, timeout: 1000 };\nconst client = createClient(configuration);';
  const ev = scan({ ...CLEAN, 'src/a.mjs': `export const a = 1;\n${pair}`, 'src/b.mjs': `export const b = 2;\n${pair}`, 'src/c.mjs': `export const c = 3;\n${pair}` });
  assert.ok(ev.dupes.some(d => d.count >= 3), 'the last two lines of a file are as much a block as any other two');
});

test('⚑ a repeated eight-line block at the very END of a file is still found', () => {
  const block = Array.from({ length: 8 }, (_, i) => `const configuration${i} = { retries: ${i}, timeout: 1000 };`).join('\n');
  const ev = scan({ ...CLEAN, 'src/a.mjs': `export const a = 1;\n${block}`, 'src/b.mjs': `export const b = 2;\n${block}` });
  assert.ok(ev.longDupes.some(d => d.count >= 2), 'the same, for the eight-line window');
});

test('⚑ the worst duplication is reported first, and the cap keeps the worst', () => {
  // The list is capped, so its ORDER decides what a reader ever sees. Sorting by anything other than
  // count silently hides the biggest offender behind an arbitrary one.
  //
  // The two block bodies are chosen so their content hashes run OPPOSITE to their repeat counts:
  // "alpha" repeats three times and hashes higher than "bravo", which repeats twice. Sorting by hash
  // therefore puts the less-repeated block first, and this test notices. Picked deliberately — with
  // arbitrary contents the two orders agree half the time and the case passes by luck.
  const block = (tag) => Array.from({ length: 8 }, (_, i) => `const ${tag}${i} = { retries: ${i}, timeout: 1000 };`).join('\n');
  const ev = scan({
    ...CLEAN,
    'src/a1.mjs': `${block('alpha')}\nexport const a1 = 1;`,
    'src/a2.mjs': `${block('alpha')}\nexport const a2 = 2;`,
    'src/a3.mjs': `${block('alpha')}\nexport const a3 = 3;`,
    'src/b1.mjs': `${block('bravo')}\nexport const b1 = 1;`,
    'src/b2.mjs': `${block('bravo')}\nexport const b2 = 2;`,
  });
  assert.ok(ev.longDupes.length >= 2, `precondition: two distinct repeated blocks, saw ${ev.longDupes.length}`);
  assert.equal(ev.longDupes[0].count, 3,
    '⚑ the block repeated three times comes before the one repeated twice — worst first, whatever their hashes happen to be');
  const counts = ev.longDupes.map(d => d.count);
  assert.deepEqual(counts, [...counts].sort((a, b) => b - a), 'and the whole list is ordered that way');
});

test('⚑ a block repeated EXACTLY twice is not "repeated more than twice"', () => {
  // EVO-01's own words. Two copies is where a second implementation legitimately exists; three is
  // where a pattern is being regenerated. Moving the line to two fails an enormous number of
  // ordinary repositories for having a pair of similar functions.
  const pair = 'const configuration = { retries: 3, timeout: 1000 };\nconst client = createClient(configuration);';
  const twice = { ...CLEAN, 'src/a.mjs': `${pair}\nexport const a = 1;`, 'src/b.mjs': `${pair}\nexport const b = 2;` };
  const ev = scan(twice);
  assert.ok(ev.dupes.some(d => d.count === 2), 'precondition: the block really does appear twice');
  assert.equal(verdictOf('EVO-01', twice).verdict, 'MET', 'twice is allowed');

  const thrice = { ...twice, 'src/c.mjs': `${pair}\nexport const c = 3;` };
  assert.equal(verdictOf('EVO-01', thrice).verdict, 'NOT_MET', 'three times is not');
});

test('⚑ exactly a quarter of commits being throwaway is NOT under a quarter', () => {
  // PRV-05 asks for FEWER than one in four. One in four is not fewer than one in four.
  const at = { git: true, commits: ['add the parser', 'wip', 'handle the empty case', 'document the rule'] };
  assert.equal(verdictOf('PRV-05', CLEAN, at).verdict, 'NOT_MET',
    '⚑ 1/4 sits exactly on the published line, and the line says "fewer than"');

  const under = { git: true, commits: ['add the parser', 'wip', 'handle the empty case', 'document the rule', 'name the boundary'] };
  assert.equal(verdictOf('PRV-05', CLEAN, under).verdict, 'MET', 'while 1/5 is genuinely under it');
});

test('a manifest description is read as the description', () => {
  const pkg = JSON.parse(CLEAN['package.json']);
  pkg.description = 'a real description of a real thing';
  const ev = scan({ ...CLEAN, 'package.json': JSON.stringify(pkg, null, 2) });
  assert.equal(ev.pkgDescription, 'a real description of a real thing',
    'ACC-04 judges this text for placeholder wording — reading anything else judges the wrong thing');

  const odd = JSON.parse(CLEAN['package.json']);
  odd.description = { text: 'not a string' };
  assert.equal(scan({ ...CLEAN, 'package.json': JSON.stringify(odd, null, 2) }).pkgDescription, null,
    'and a description that is not text is no description at all, rather than an object to match against');
});

test('⚑ a TWO-line block that appears once is not duplication either', () => {
  // The two-line scan carries its own copy of "more than one occurrence". Reporting singles makes
  // ev.dupes a list of every pair of lines in the repository, and EVO-01's evidence then announces a
  // count of "blocks appearing exactly twice" that is really just the size of the codebase.
  const files = { ...CLEAN, 'src/unique.mjs': ['const somethingParticular = { a: 1 };', 'const anotherThingEntirely = [2, 3];', 'export const u = 1;'].join('\n') };
  const ev = scan(files);
  assert.equal(ev.dupes.length, 0, 'nothing here repeats, so nothing is listed');
  assert.match(verdictOf('EVO-01', files).evidence, /0 appear exactly twice/,
    '⚑ and the evidence says none — a number that counts single occurrences is not a duplication count');
});

test('⚑ the two-line duplication list is ordered worst-first', () => {
  // Same shape as the eight-line list, and a separate copy of the same sort. The two block bodies
  // are picked so their hashes run OPPOSITE to their counts — with arbitrary contents the two orders
  // agree half the time and the case passes by luck.
  const pair = (t) => `const ${t}Config = { retries: 3, timeout: 1000 };\nconst ${t}Client = createClient(${t}Config);`;
  const ev = scan({
    ...CLEAN,
    'src/a1.mjs': `${pair('alpha')}\nexport const a1 = 1;`,
    'src/a2.mjs': `${pair('alpha')}\nexport const a2 = 2;`,
    'src/a3.mjs': `${pair('alpha')}\nexport const a3 = 3;`,
    'src/b1.mjs': `${pair('bravo')}\nexport const b1 = 1;`,
    'src/b2.mjs': `${pair('bravo')}\nexport const b2 = 2;`,
  });
  assert.ok(ev.dupes.length >= 2, `precondition: two distinct repeated pairs, saw ${ev.dupes.length}`);
  assert.equal(ev.dupes[0].count, 3,
    '⚑ the pair repeated three times comes first, whatever its hash happens to be — the list is capped, so its order decides what a reader ever sees');
  const counts = ev.dupes.map(d => d.count);
  assert.deepEqual(counts, [...counts].sort((a, b) => b - a), 'and the whole list runs commonest-first');
});

test('⚑ a block that appears once is not duplication', () => {
  // "appears in two or more places" means two. Counting single occurrences makes every eight
  // consecutive lines in the codebase its own finding — the criterion stops meaning anything and
  // starts reporting the size of the repository.
  const block = Array.from({ length: 8 }, (_, i) => `const solitary${i} = ${i};`).join('\n');
  const ev = scan({ ...CLEAN, 'src/only.mjs': `${block}\nexport const a = 1;` });
  assert.equal(ev.longDupes.length, 0, 'nothing here appears twice, so nothing is reported');
  assert.equal(verdictOf('EVO-03', { ...CLEAN, 'src/only.mjs': `${block}\nexport const a = 1;` }).verdict, 'MET',
    '⚑ and the criterion says so — a repository of entirely unique code must not fail the criterion for repeated code');
});

test('⚑ blank and comment lines are not part of an eight-line code block', () => {
  // The eight-line window closes gaps over blanks and comments on purpose — regenerated code differs
  // mainly in spacing. That only works if those lines are excluded rather than counted as content.
  const body = Array.from({ length: 8 }, (_, i) => `const configuration${i} = { retries: ${i}, timeout: 1000 };`);
  const spaced = body.flatMap((l, i) => (i % 2 ? [l, '', `// a note ${i}`] : [l]));
  const ev = scan({ ...CLEAN, 'src/a.mjs': `${spaced.join('\n')}\nexport const a = 1;`, 'src/b.mjs': `${body.join('\n')}\nexport const b = 2;` });
  assert.ok(ev.longDupes.some(d => d.count >= 2),
    '⚑ the same eight statements, one copy spaced out and commented — that is regenerated-not-factored, and formatting must not hide it');
});

test('⚑ a comment in the ignore file is a comment, even when a path shares its text', () => {
  // Blank and comment lines are stripped before the ignore list is built. Keeping them turns the
  // text of a comment into a path prefix — and then a repository is silently un-scanned by its own
  // documentation. `#notes` is a legal directory name, which is what makes this reachable rather
  // than theoretical.
  const ev = scan({
    ...CLEAN,
    '.assessorignore': '#notes\n\nbuild\n',
    '#notes/kept.mjs': 'export const kept = 1;\n',
    'build/out.mjs': 'export const built = 1;\n',
  });
  const rels = ev.files.map(f => f.rel);
  assert.ok(rels.includes('#notes/kept.mjs'),
    '⚑ the comment named a real directory, and a comment must not quietly become an ignore rule');
  assert.ok(!rels.some(r => r.startsWith('build/')), 'while the real entry below it still ignores what it names');
});

test('⚑ a decision record is found by its directory OR by its name', () => {
  const byDir = scan({ ...CLEAN, 'docs/decisions/choose-a-thing.md': '# Choose\n\nWe chose.\n' });
  assert.equal(byDir.adrFiles.length, 1, 'a decisions/ directory holds decision records whatever the files are called');

  const byName = scan({ ...CLEAN, 'notes/0001-choose-a-thing.md': '# Choose\n\nWe chose.\n' });
  assert.equal(byName.adrFiles.length, 1,
    '⚑ and the numbered-record convention is a decision record wherever it lives — requiring BOTH would find only the ones that need finding least');

  const neither = scan({ ...CLEAN, 'notes/thoughts.md': '# Thoughts\n\nSome.\n' });
  assert.equal(neither.adrFiles.length, 0, 'while an ordinary note is not a decision record');
});

test('⚑ a repository with no manifest has no manifest', () => {
  const files = { ...CLEAN };
  delete files['package.json'];
  const ev = scan(files);
  assert.equal(ev.hasPkg, false,
    '⚑ inverting this makes every repository look like it has a package.json, and the criteria that depend on one then read a manifest that is not there');
  assert.equal(verdictOf('ACC-04', files).verdict, 'N/A', 'so the manifest-ownership criterion does not apply');
});

test('⚑ a manifest with an explicitly null section is read to the end', () => {
  // A null section is valid JSON. Walking into it throws, the throw is swallowed by the manifest
  // reader's own catch, and everything AFTER that point is silently lost. Asserting on the
  // dependencies would not notice — they are read before the walk. The script paths are read after,
  // so they are what proves the reader got all the way through.
  const pkg = JSON.parse(CLEAN['package.json']);
  pkg.exports = null;
  pkg.dependencies = { alpha: '^1' };
  const ev = scan({ ...CLEAN, 'package.json': JSON.stringify(pkg, null, 2) });
  assert.deepEqual(ev.deps, ['alpha'], 'the dependencies are read');
  assert.ok(ev.manifestRefs.includes('tests/index.test.mjs'),
    '⚑ and so are the script paths that come after the null — otherwise BND-03 checks a manifest it only half read, and every path it never reached is reported as fine');
});

test('⚑ a codebase of exactly thirty lines is assessed for LARGE duplication too', () => {
  // EVO-03 carries its own copy of the thirty-line guard. Two copies of a rule are two places for it
  // to be wrong, and the earlier boundary case only exercised EVO-01's.
  const files = { ...CLEAN, 'src/index.mjs': lines(29) + '\n' };
  delete files['tests/index.test.mjs'];
  const ev = scan(files);
  assert.equal(ev.totalLines, 30, `precondition: exactly thirty lines, saw ${ev.totalLines}`);
  assert.notEqual(verdictOf('EVO-03', files).verdict, 'N/A', '"under 30 lines" excuses 29, not 30');

  const smaller = { ...CLEAN, 'src/index.mjs': lines(28) + '\n' };
  delete smaller['tests/index.test.mjs'];
  assert.equal(verdictOf('EVO-03', smaller).verdict, 'N/A', 'while twenty-nine is genuinely too little to read anything into');
});

test('⚑ a decision record whose very first line is the Status heading is read', () => {
  // The heading search returns an index, and the guard accepts index zero. A record that opens with
  // its Status — no title above it — is the one case where that distinction shows, and it is a
  // perfectly ordinary way to write one.
  const first = scan({ ...CLEAN, 'docs/adr/0001-choose.md': '## Status\n\nTBD\n\n# Choose\n\nWe chose.\n' });
  assert.equal(first.adrBad.length, 1, 'the placeholder is found even with the heading on line one');
  assert.match(first.adrBad[0].text, /TBD/, 'and quoted back');

  const accepted = scan({ ...CLEAN, 'docs/adr/0001-choose.md': '## Status\n\nAccepted\n\n# Choose\n\nWe chose.\n' });
  assert.equal(accepted.adrBad.length, 0, 'and a real status there is accepted rather than reported as missing');
});

test('⚑ an undefined command is labelled by the runner it was documented for', () => {
  // The sample says "run build" or "make build". Those send the reader to two different files, and
  // the label is the only thing that tells them which.
  const viaScript = verdictOf('SPEC-05', { ...CLEAN, 'README.md': '# A tool\n\nIt does a real thing.\n\n```sh\nnpm run build\n```\n' });
  assert.equal(viaScript.verdict, 'NOT_MET');
  assert.deepEqual(viaScript.sample.map(s => s.text), ['run build'],
    '⚑ documented as an npm script, so the finding says run — telling them "make build" sends them to a Makefile that was never the problem');

  const viaMake = verdictOf('SPEC-05', {
    ...CLEAN,
    'README.md': '# A tool\n\nIt does a real thing.\n\n```sh\nmake release\n```\n',
    'Makefile': 'build:\n\techo hi\n',
  });
  assert.equal(viaMake.verdict, 'NOT_MET');
  assert.deepEqual(viaMake.sample.map(s => s.text), ['make release'], 'and a make target says make');
});

test('⚑ only declared build outputs are treated as build outputs', () => {
  const pkg = JSON.parse(CLEAN['package.json']);
  pkg.scripts = { test: 'node --test tests/index.test.mjs', build: 'esbuild src/index.mjs --bundle --outfile dist/out.js' };
  const ev = scan({ ...CLEAN, 'package.json': JSON.stringify(pkg, null, 2) });
  assert.deepEqual([...ev.buildOutputs], ['dist/out.js'],
    '⚑ the token after a build-output flag, and nothing else. Treating every token as an output would excuse every dead manifest path in the project');
});

test('⚑ a documented command that is not defined is named, not just counted', () => {
  const r = verdictOf('SPEC-05', {
    ...CLEAN,
    'README.md': '# A tool\n\nIt does a real thing.\n\n```sh\nnpm run build\nnpm run test\n```\n',
  });
  assert.equal(r.verdict, 'NOT_MET', 'the README promises a build command the manifest does not define');
  assert.match(JSON.stringify(r.sample || []), /build/,
    '⚑ and says which one — "1 documented run command not defined" sends the reader to compare two lists by hand');
});

test('and a README whose commands all exist is met', () => {
  const r = verdictOf('SPEC-05', { ...CLEAN, 'README.md': '# A tool\n\nIt does a real thing.\n\n```sh\nnpm run test\n```\n' });
  assert.equal(r.verdict, 'MET', 'the manifest defines test, so the README is keeping its promise');
});

test('⚑ author identity survives a commit line with a missing half', () => {
  // Names and emails are read from one git record split on a NUL. A fallback that returns nothing
  // instead of an empty string turns every author into a blank, and a blank matches no placeholder,
  // so the criterion quietly passes every repository.
  const ev = gather(mk(CLEAN, { git: true, author: { name: 'A Real Person', email: 'real@company.com' } }));
  assert.ok(ev.git.authors.length > 0, 'authors were read');
  for (const a of ev.git.authors) {
    assert.equal(typeof a.name, 'string', 'a name is always a string');
    assert.equal(typeof a.email, 'string', 'and so is an email');
    assert.ok(a.name.length > 0 && a.email.length > 0,
      '⚑ and neither is empty for a properly configured commit — an empty identity matches no placeholder and would pass the criterion by erasing the evidence');
  }
});
