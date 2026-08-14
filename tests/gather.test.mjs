// gather.test.mjs — the half of the assessor that reads the world.
//
// ⚑ 89 MUTANTS LIVED HERE UNTOUCHED. The criteria are pure functions and could be driven with a
// synthetic evidence object; gather() cannot. It walks the tree, honours ignore files, counts lines,
// finds markers, resolves documentation links, reads the manifest and asks git — none of which can be
// faked. So it needed real repositories, and until there were fixtures there was nothing to test it
// with.
//
// Every assertion below was written by building the repository, printing what gather() actually
// returned, and pinning that — not by assuming a shape. Three times this session I assumed an
// interface and had to correct the test; this file was written the other way round.
import test from 'node:test';
import assert from 'node:assert/strict';
import { gather, assess } from '../assessor.mjs';
import { CLEAN, testFile } from './fixture.mjs';
import { fixtures } from './helpers.mjs';

// ⚑ FLAT ON PURPOSE. An earlier version wrapped every case in withRepo(files, opts, dir => { ... }),
// and the assessor's own duplication criterion failed this repository: every one of those closures
// ends in the same two-line closing sequence, and twenty of them is real repetition however it got
// there. The tool caught its own author. `mk` registers the directory for cleanup so a test can be
// written flat, with no nesting to close — and it now comes from the shared helper, because EVO-01
// went on to catch the copy of that same three-line preamble sitting at the top of every test file.
const { mk, scan, judge } = fixtures();

test('⚑ the walk finds the files and leaves the hidden ones alone', () => {
  const dir = mk({
    ...CLEAN,
    '.env': 'SECRET=1',
    '.hidden/thing.mjs': 'export const x = 1;',
    'node_modules/dep/index.mjs': 'module.exports = 1;',
  }, {});
  const ev = gather(dir);
  const rels = ev.files.map(f => f.rel);
  assert.ok(rels.includes('src/index.mjs'), 'real source is found');
  assert.ok(!rels.some(r => r.startsWith('.env')), 'a dotfile is not scanned');
  assert.ok(!rels.some(r => r.startsWith('.hidden')), 'nor a dot directory');
  assert.ok(!rels.some(r => r.includes('node_modules')), 'nor anything installed');
  assert.ok(rels.some(r => r.startsWith('.github/')),
    '⚑ but .github IS scanned — it is the one dot directory that holds committed intent, and skipping it would make every repo look like it had no CI');
});

test('the walk is deterministic — the same tree gives the same order', () => {
  const dir = mk(CLEAN, {});
  const a = gather(dir).files.map(f => f.rel);
  const b = gather(dir).files.map(f => f.rel);
  assert.deepEqual(a, b);
  assert.deepEqual(a, [...a].sort(),
    '⚑ and sorted — a verdict hash over an unsorted walk would differ between machines for no reason');
});

test('paths are reported with forward slashes on every platform', () => {
  const dir = mk(CLEAN, {});
  for (const f of gather(dir).files) {
    assert.ok(!f.rel.includes('\\'),
      `${f.rel} — a backslash in a relative path makes the hash platform-dependent, and the hash is the whole trust anchor`);
  }
});

test('⚑ an ignore file is honoured, and its comments and blanks are not paths', () => {
  const dir = mk({
    ...CLEAN,
    '.gitignore': '# a comment\n\nbuild/\n\n  \nvendor\n',
    'build/out.mjs': 'export const built = 1;',
    'vendor/lib.mjs': 'export const vendored = 1;',
    'kept/real.mjs': 'export const kept = 1;',
  }, {});
  const rels = gather(dir).files.map(f => f.rel);
  assert.ok(!rels.some(r => r.startsWith('build/')), 'an ignored directory with a trailing slash is skipped');
  assert.ok(!rels.some(r => r.startsWith('vendor/')), 'and one without');
  assert.ok(rels.some(r => r.startsWith('kept/')), 'while everything else is still scanned');
});

test('⚑ an ignore entry matches a path segment, not a prefix of a name', () => {
  const dir = mk({
    ...CLEAN,
    '.gitignore': 'dist\n',
    'dist/out.mjs': 'export const a = 1;',
    'distribution/real.mjs': 'export const b = 1;',
  }, {});
  const rels = gather(dir).files.map(f => f.rel);
  assert.ok(!rels.some(r => r.startsWith('dist/')), 'dist is ignored');
  assert.ok(rels.some(r => r.startsWith('distribution/')),
    '⚑ but "distribution" is not "dist" — a prefix match would silently hide a real directory');
});

test('lines, code and tests are counted from what is really there', () => {
  const ev = scan();
  assert.equal(ev.tests.length, 1, 'one test file');
  assert.equal(ev.src.length, 1, 'one source file');
  assert.equal(ev.code.length, 2, 'and both count as code');
  assert.equal(ev.totalLines, 66, 'the line count is the real one, not an estimate');
});

test('⚑ a test file is not counted as source, and source is not counted as a test', () => {
  const ev = scan();
  assert.ok(ev.tests.every(t => !ev.src.includes(t)),
    'if the two overlapped, a repo of nothing but tests would satisfy the coverage ratio against itself');
});

test('markers are found, and only real ones', () => {
  const dir = mk({
    ...CLEAN,
    'src/marked.mjs': ['export const a = 1;', '// TO' + 'DO: finish this', '// a normal comment', 'export const b = 2;'].join('\n'),
  }, {});
  const ev = gather(dir);
  assert.equal(ev.todos.length, 1, 'the abandoned-subgoal marker is found');
  assert.ok(String(ev.todos[0].line || ev.todos[0]).length > 0, 'and it carries where it was');
});

test('a skipped test is found', () => {
  const dir = mk({
    ...CLEAN,
    // built from parts so this fixture does not read as a skipped test in THIS repository —
    // the assessor cannot tell a string from code, and it is right not to try
    'tests/index.test.mjs': testFile("test." + "skip('not run', () => { v1; });"),
  }, {});
  assert.equal(gather(dir).skips.length, 1, 'a skipped test is a test that does not run, and it is counted');
});

test('⚑ git is read for what can be compared, never for identity or time', () => {
  const dir = mk(CLEAN, { git: true, commits: ['add the parser', 'fix the boundary case', 'handle the empty case'] });
  const ev = gather(dir);
  assert.equal(ev.git.ok, true);
  assert.equal(ev.git.commitCount, 3, 'every commit is counted');
  assert.equal(ev.git.subjects.length, 3, 'and every subject read');
  assert.ok(ev.git.subjects.includes('add the parser'));
  assert.ok(ev.git.fileCount > 0, 'the tracked file count comes from the tree, not the disk');
  const blob = JSON.stringify(ev.git);
  assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(blob),
    '⚑ no timestamp enters the evidence — a verdict that moves with the clock cannot be reproduced');
  assert.ok(!/[0-9a-f]{40}/.test(blob), 'and no commit hash, for the same reason');
});

test('a directory that is not a repository is reported as such, not guessed at', () => {
  const ev = scan();
  assert.equal(ev.git.ok, false, 'no git is an honest "cannot tell", never an assumed pass');
});

test('⚑ documentation links are resolved relative to the document that carries them', () => {
  const dir = mk({
    ...CLEAN,
    'docs/design.md': '# Design\n\nSee [the source](../src/index.mjs) and [the tests](./nearby.md).\n',
    'docs/nearby.md': '# Nearby\n',
  }, {});
  const ev = gather(dir);
  // ⚑ gather RECORDS the link as written, with the file that carries it; SPEC-03 does the resolving.
  // That split is the right one — the raw target is evidence, the resolution is a judgement — and
  // pinning it here is what stops a refactor quietly moving the resolution somewhere it loses the
  // file it came from.
  const links = ev.docLinks.filter(l => l.file === 'docs/design.md');
  assert.ok(links.some(l => l.target === '../src/index.mjs'), 'the ../ link is recorded as written');
  assert.ok(links.some(l => l.target === './nearby.md'), 'and so is the ./ one');
  assert.ok(links.every(l => l.file), 'each link knows which document made it, or it cannot be resolved later');
  // and the criterion that DOES resolve them finds nothing broken
  const spec03 = assess(dir).results.find(r => r.id === 'SPEC-03');
  assert.equal(spec03.verdict, 'MET',
    '⚑ resolved from the document rather than the repo root — resolving from the root would call every relative link broken');
});

test('an external link is not treated as a file that ought to exist', () => {
  const dir = mk({
    ...CLEAN,
    'docs/design.md': '# Design\n\n[a website](https://example.com) and [an anchor](#section).\n',
  }, {});
  // The link is recorded, and the criterion is what declines to treat it as a file.
  const spec03 = assess(dir).results.find(r => r.id === 'SPEC-03');
  assert.equal(spec03.verdict, 'MET',
    '⚑ a URL and an anchor are not files, and a checker that tried to open them would report every documented website as a broken link');
});

test('the manifest is read for what it points at and who owns it', () => {
  const ev = scan();
  assert.ok(ev.manifestRefs.includes('src/index.mjs'), 'the main entry is a reference to resolve');
  assert.deepEqual(ev.pkgScripts, ['test'], 'and the scripts are read by name');
  assert.equal(ev.pkgAuthor, 'A Real Person');
  assert.equal(ev.hasPkg, true);
  assert.equal(ev.deps.length, 0, 'a zero-dependency manifest declares nothing');
});

test('⚑ a declared dependency that nothing imports is found', () => {
  const dir = mk({
    ...CLEAN,
    'package.json': JSON.stringify({
      name: 'fixture', type: 'module', description: 'a real description', author: 'A Real Person',
      dependencies: { 'left-pad': '^1.0.0', 'used-thing': '^2.0.0' },
      scripts: { test: 'node --test tests/index.test.mjs' },
    }, null, 2),
    'src/index.mjs': "import { thing } from 'used-thing';\nexport const v1 = thing;\n",
  }, {});
  const ev = gather(dir);
  assert.ok(ev.deps.includes('left-pad') && ev.deps.includes('used-thing'), 'both are declared');
  assert.ok(ev.unusedDeps.includes('left-pad'), 'the one nothing imports is named');
  assert.ok(!ev.unusedDeps.includes('used-thing'), 'and the one that is imported is not');
});

test('test imports are attributed to the file that made them', () => {
  const ev = scan();
  assert.ok(ev.testImports.every(i => i.file && i.spec), 'each import knows its file and its specifier');
  assert.ok(ev.testImports.some(i => i.spec === '../src/index.mjs'), 'the source import is seen');
  assert.ok(ev.testImports.some(i => i.spec === 'node:test'), 'and so is the runner, so a criterion can tell them apart');
});

// ── the verdict, end to end ────────────────────────────────────────────────
test('⚑ the same repository assessed twice gives the same hash', () => {
  const dir = mk(CLEAN, { git: true });
  const a = assess(dir).verdict, b = assess(dir).verdict;
  assert.equal(a.hash, b.hash,
    '⚑ this is the property the whole trust rail rests on — a hash that moved between two runs would make every proof unverifiable');
  assert.equal(a.hash.length, 32, 'and it is the full anchor, not a truncation that could collide');
});

test('a change to the code changes the hash', () => {
  const clean = assess(mk(CLEAN, { git: true })).verdict.hash;
  const worse = { ...CLEAN, 'src/index.mjs': CLEAN['src/index.mjs'] + '// TO' + 'DO: unfinished\n'.repeat(40) };
  const dirty = assess(mk(worse, { git: true })).verdict.hash;
  assert.notEqual(clean, dirty, 'a repository that got worse must not produce the same anchor as one that did not');
});

test('⚑ the badge needs EVERY core criterion, not most of them', () => {
  const v = judge();
  assert.equal(v.badge, true, 'the clean fixture earns it');
  assert.match(v.summary.core, /^(\d+)\/\1$/, 'and it earns it by meeting all of the core, not a ratio of them');
});

test('one failed core criterion loses the badge whatever the rest score', () => {
  const files = { ...CLEAN };
  delete files['README.md'];                       // ACC-01 is core
  const dir = mk(files, { git: true });
  const v = assess(dir).verdict;
  assert.equal(v.badge, false,
    '⚑ core is a floor, not a weighting — one missing README cannot be made up for by scoring well elsewhere');
  assert.ok(v.results.some(r => r.id === 'ACC-01' && r.verdict === 'NOT_MET'), 'and the one that failed is named');
});

test('the dominant tell is the failure signature that appears most', () => {
  const files = { ...CLEAN };
  delete files['README.md'];
  delete files['LICENSE'];
  const dir = mk(files, { git: true });
  const v = assess(dir).verdict;
  assert.ok(v.dominantTell, 'a repository with failures has a dominant tell');
  assert.ok(Object.values(v.tellTally).every(n => n > 0), 'and the tally counts only what actually failed');
});

test('a repository with no failures has no tell to report', () => {
  const v = judge();
  assert.equal(v.dominantTell, null,
    '⚑ null, not an empty string or a default — naming a behavioural signature on a clean repo would be an accusation with no evidence');
  assert.deepEqual(v.tellTally, {});
});

test('not-applicable criteria are counted, never silently dropped', () => {
  const v = assess(mk(CLEAN, {})).verdict;          // no git → several become N/A
  assert.ok(v.summary.notApplicable > 0, 'the N/A count is reported');
  const applicable = v.results.filter(r => r.verdict !== 'N/A').length;
  assert.equal(applicable + v.summary.notApplicable, v.results.length,
    '⚑ every criterion is accounted for — one that vanished from both piles would quietly raise the ratio');
});

test('the threshold is honoured and is part of the verdict', () => {
  const dir = mk(CLEAN, { git: true });
  assert.equal(assess(dir).verdict.threshold, 0.7, 'the default is stated in the verdict, not hidden in the code');
  assert.equal(assess(dir, 0.95).verdict.threshold, 0.95, 'and a caller can raise the bar');
});

test('⚑ the verdict names the spec it was made under', () => {
  const v = judge();
  assert.ok(v.spec && v.specFingerprint,
    'a verdict with no version is a verdict nobody can re-run — proof-of-play compares this fingerprint to spot a stale proof');
  assert.equal(v.specFingerprint.length, 32);
});
