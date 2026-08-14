// criteria.test.mjs — every criterion, through every branch it has.
//
// ⚑ THE BENCHMARK BEHIND THE TRUST RAIL SCORED 16% ON ITS OWN GATE. proof-of-play's whole claim rests
// on a hash this file produces, and proof-of-play is now mutation-gated — but the thing it ASKS was
// not. Point witness at assessor.mjs and 121 of 144 mutants survived. 23 killed.
//
// The reason is structural, not careless: the existing suite asserts two whole-repo verdicts (a clean
// demo passes, a slop demo fails) and a couple of specifics. A whole-repo verdict exercises each
// criterion once, on one input, in whichever branch that repo happens to land in. Twenty-seven
// criteria have three branches each — MET, NOT MET, and N/A when there is nothing to judge — and a
// pass/fail pair reaches barely a third of them.
//
// Every criterion here is a pure function of an evidence object, so each branch can be driven
// directly. That is the whole reason this is feasible: the design was already testable, nobody had
// walked it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CRITERIA } from '../assessor.mjs';

const by = (id) => {
  const c = CRITERIA.find(x => x.id === id);
  if (!c) throw new Error(`no criterion ${id} — the spec changed and this test did not`);
  return c;
};
const v = (id, ev) => by(id).assess({ ...BASE, ...ev }).verdict;

// A repository that is unremarkable in every dimension. Each case below changes one thing, so a
// verdict that moves can only have moved because of that thing.
const BASE = {
  root: '.',
  files: ['a.mjs'], code: ['a.mjs'], tests: ['t.test.mjs'], src: ['a.mjs'],
  totalLines: 500, todos: [], skips: [], longFns: [], dupes: [], longDupes: [],
  hasLicense: true, hasReadme: true, hasCI: true, hasLock: true, hasPkg: true,
  hasSpec: true, hasAgentCfg: true,
  deps: [], usedDeps: {}, unusedDeps: [],
  pkgAuthor: 'someone', pkgDescription: 'a real description',
  testImports: [{ spec: '../a.mjs' }], manifestRefs: [], buildOutputs: {}, defectMarkers: [],
  git: { ok: true, commitCount: 9, subjects: ['add the parser', 'fix the boundary case'], authors: ['a'], fileCount: 12 },
  pathSet: {}, docFiles: ['README.md'], docLinks: [], readmeText: 'a real readme with real content',
  ciText: 'npm test', testCases: 10, assertions: 30, adrFiles: [], adrBad: [],
  docRunCmds: [], makeTargets: new Set(), pkgScripts: ['test'],
};

test('the criteria list is the one these tests were written against', () => {
  assert.equal(CRITERIA.length, 27, '⚑ a criterion added or removed without a test is how coverage rots back');
  for (const c of CRITERIA) {
    assert.ok(typeof c.assess === 'function', `${c.id} must be assessable`);
    assert.ok(c.criterion && c.why, `${c.id} must say what it checks and why — a rule with no reason cannot be argued with`);
  }
});

test('SPEC-01 · a design record exists', () => {
  assert.equal(v('SPEC-01', { hasSpec: true }), 'MET');
  assert.equal(v('SPEC-01', { hasSpec: false }), 'NOT_MET');
});

test('SPEC-02 · abandoned markers, by density and not by count', () => {
  assert.equal(v('SPEC-02', { totalLines: 29 }), 'N/A', 'under thirty lines there is nothing to take a density of');
  assert.equal(v('SPEC-02', { totalLines: 30, todos: [] }), 'MET', '⚑ and exactly thirty lines IS assessable — the boundary belongs to the check');
  assert.equal(v('SPEC-02', { totalLines: 200, todos: ['a'] }), 'NOT_MET', 'one marker in two hundred lines is exactly the limit, and the limit is not met');
  assert.equal(v('SPEC-02', { totalLines: 400, todos: ['a'] }), 'MET', 'one in four hundred is under it');
  assert.equal(v('SPEC-02', { totalLines: 1000, todos: [] }), 'MET', 'and none at all passes');
});

test('SPEC-03 · documentation links resolve', () => {
  assert.equal(v('SPEC-03', { docFiles: [] }), 'N/A', 'no documentation, nothing to check');
  assert.equal(v('SPEC-03', { docLinks: [] }), 'MET', 'documentation with no links has no broken ones');
});

test('SPEC-04 · decision records', () => {
  assert.equal(v('SPEC-04', { adrFiles: [] }), 'N/A', 'no ADRs, nothing to check');
  assert.equal(v('SPEC-04', { adrFiles: ['adr-1.md'], adrBad: [] }), 'MET');
  assert.equal(v('SPEC-04', { adrFiles: ['adr-1.md'], adrBad: ['adr-1.md'] }), 'NOT_MET');
});

test('SPEC-05 · commands the docs tell you to run actually exist', () => {
  assert.equal(v('SPEC-05', { docRunCmds: [] }), 'N/A', 'docs that name no commands cannot name a wrong one');
  assert.equal(v('SPEC-05', { docRunCmds: [{ kind: 'npm', name: 'test' }], pkgScripts: ['test'] }), 'MET');
  assert.equal(v('SPEC-05', { docRunCmds: [{ kind: 'make', name: 'build' }], makeTargets: new Set(['build']) }), 'MET',
    'a make target counts as defined too');
  assert.equal(v('SPEC-05', { docRunCmds: [{ kind: 'npm', name: 'build' }], pkgScripts: ['test'] }), 'NOT_MET',
    '⚑ a README telling somebody to run a command that does not exist is the first thing they will try');
});

test('VER-01 · tests exist at all', () => {
  assert.equal(v('VER-01', { tests: ['t.test.mjs'] }), 'MET');
  assert.equal(v('VER-01', { tests: [] }), 'NOT_MET');
});

test('VER-02 · no skipped tests', () => {
  assert.equal(v('VER-02', { tests: [] }), 'N/A', 'no tests, nothing skipped');
  assert.equal(v('VER-02', { skips: [] }), 'MET');
  assert.equal(v('VER-02', { skips: ['t.test.mjs:12'] }), 'NOT_MET', 'a skipped test is a test that is not run');
});

test('VER-03 · enough test files for the source', () => {
  assert.equal(v('VER-03', { src: [] }), 'N/A', 'no source, nothing to test');
  assert.equal(v('VER-03', { tests: ['a'], src: ['a', 'b', 'c'] }), 'MET', 'one test file per three sources meets the ratio');
  assert.equal(v('VER-03', { tests: [], src: ['a', 'b', 'c', 'd', 'e'] }), 'NOT_MET');
});

test('VER-04 · CI exists', () => {
  assert.equal(v('VER-04', { hasCI: true }), 'MET');
  assert.equal(v('VER-04', { hasCI: false }), 'NOT_MET');
});

test('VER-05 · the tests import the source they claim to test', () => {
  assert.equal(v('VER-05', { tests: [] }), 'N/A');
  assert.equal(v('VER-05', { testImports: [{ spec: '../a.mjs' }] }), 'MET', 'a relative import reaches real source');
  assert.equal(v('VER-05', { testImports: [{ spec: '../tests/helper.mjs' }] }), 'NOT_MET',
    'and an import of the test folder is not an import of the source');
  assert.equal(v('VER-05', { testImports: [{ spec: 'node:test' }, { spec: 'node:assert' }] }), 'NOT_MET',
    '⚑ a test file importing only the test runner tests nothing — it is the purest form of test theatre');
});

test('VER-06 · CI actually runs the tests', () => {
  assert.equal(v('VER-06', { hasCI: false }), 'N/A', 'no CI to inspect');
  assert.equal(v('VER-06', { ciText: 'npm test' }), 'MET');
  assert.equal(v('VER-06', { ciText: 'echo hello' }), 'NOT_MET',
    '⚑ a workflow that never runs the tests is a green tick that means nothing');
  assert.equal(v('VER-06', { ciText: 'yarn run test' }), 'MET', 'and the other package managers count too');
});

test('VER-07 · the tests assert something', () => {
  assert.equal(v('VER-07', { tests: [] }), 'N/A');
  assert.equal(v('VER-07', { testCases: 0 }), 'N/A', 'no cases, nothing to assert in');
  assert.equal(v('VER-07', { testCases: 10, assertions: 30 }), 'MET');
  assert.equal(v('VER-07', { testCases: 10, assertions: 0 }), 'NOT_MET',
    '⚑ ten test cases and no assertions is ten functions that cannot fail');
});

test('BND-01 · a committed agent instruction file', () => {
  assert.equal(v('BND-01', { hasAgentCfg: true }), 'MET');
  assert.equal(v('BND-01', { hasAgentCfg: false }), 'NOT_MET');
});

test('BND-02 · declared dependencies are used', () => {
  assert.equal(v('BND-02', { hasPkg: false }), 'N/A', 'no manifest this assessor reads');
  assert.equal(v('BND-02', { deps: [] }), 'MET',
    '⚑ zero dependencies is a PASS, not "not applicable" — depending on nothing is the strongest form of this criterion, and calling it N/A would deny every zero-dependency tool the credit');
  assert.equal(v('BND-02', { deps: ['x'], unusedDeps: [] }), 'MET');
  assert.equal(v('BND-02', { deps: ['x'], unusedDeps: ['x'] }), 'NOT_MET');
});

test('BND-03 · files the manifest points at exist', () => {
  assert.equal(v('BND-03', { hasPkg: false }), 'N/A');
  assert.equal(v('BND-03', { manifestRefs: [] }), 'MET', 'a manifest pointing at nothing has no broken pointers');
});

test('ACC-01 and ACC-02 · a README and a licence', () => {
  assert.equal(v('ACC-01', { hasReadme: true }), 'MET');
  assert.equal(v('ACC-01', { hasReadme: false }), 'NOT_MET');
  assert.equal(v('ACC-02', { hasLicense: true }), 'MET');
  assert.equal(v('ACC-02', { hasLicense: false }), 'NOT_MET');
});

test('ACC-03 · the README is not still the template', () => {
  assert.equal(v('ACC-03', { readmeText: null }), 'N/A', 'no README to read');
  assert.equal(v('ACC-03', { readmeText: 'a real description of a real thing' }), 'MET');
  assert.equal(v('ACC-03', { readmeText: 'lorem ipsum dolor sit amet' }), 'NOT_MET',
    '⚑ a README still carrying its placeholder is a project that was generated and never looked at');
});

test('ACC-04 · the manifest says who owns it and what it is', () => {
  assert.equal(v('ACC-04', { hasPkg: false }), 'N/A');
  assert.equal(v('ACC-04', { pkgAuthor: 'someone', pkgDescription: 'something' }), 'MET');
  assert.equal(v('ACC-04', { pkgAuthor: null, pkgDescription: null }), 'N/A',
    'no ownership fields at all is nothing to judge — ACC-01 and the manifest checks cover absence');
  assert.equal(v('ACC-04', { pkgAuthor: 'your name here', pkgDescription: 'TODO' }), 'NOT_MET',
    '⚑ a manifest still carrying its template values names nobody');
});

test('ACC-05 · history has a readable author', () => {
  assert.equal(v('ACC-05', { git: { ...BASE.git, ok: false } }), 'N/A', 'no history to read');
  assert.equal(v('ACC-05', { git: { ...BASE.git, authors: [] } }), 'N/A', 'history with no authors is the same case');
  assert.equal(v('ACC-05', { git: { ...BASE.git, authors: ['a real person'] } }), 'MET');
});

test('EVO-01 and EVO-03 · duplication, and only above the size floor', () => {
  assert.equal(v('EVO-01', { totalLines: 29 }), 'N/A', 'too small to judge duplication');
  assert.equal(v('EVO-03', { totalLines: 29 }), 'N/A');
  assert.equal(v('EVO-01', { dupes: [] }), 'MET');
  assert.equal(v('EVO-03', { longDupes: [] }), 'MET');
  assert.equal(v('EVO-03', { longDupes: [{ lines: 40 }] }), 'NOT_MET');
});

test('EVO-02 · no admitted defects left in comments', () => {
  assert.equal(v('EVO-02', { defectMarkers: [] }), 'MET');
  assert.equal(v('EVO-02', { defectMarkers: ['a.mjs:12 broken'] }), 'NOT_MET',
    '⚑ a defect the author wrote down and did not fix is a known hazard shipped in place');
  assert.equal(v('EVO-02', { defectMarkers: undefined }), 'MET', 'and an absent list is not a defect');
});

test('PRV-01 · a lockfile where one is expected', () => {
  assert.equal(v('PRV-01', { hasPkg: false }), 'N/A');
  assert.equal(v('PRV-01', { deps: [], hasLock: false }), 'N/A', '⚑ no dependencies means no lockfile is needed — demanding one would fail every zero-dependency tool in the estate');
  assert.equal(v('PRV-01', { deps: ['x'], hasLock: true }), 'MET');
  assert.equal(v('PRV-01', { deps: ['x'], hasLock: false }), 'NOT_MET');
});

test('PRV-02 · a .git directory, checked on the real filesystem', () => {
  const dir = mkdtempSync(join(tmpdir(), 'acg-'));
  try {
    assert.equal(by('PRV-02').assess({ ...BASE, root: dir }).verdict, 'NOT_MET', 'no .git is no history');
    mkdirSync(join(dir, '.git'));
    assert.equal(by('PRV-02').assess({ ...BASE, root: dir }).verdict, 'MET');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('PRV-03 · more than one commit, for a repository big enough to have needed one', () => {
  assert.equal(v('PRV-03', { git: { ...BASE.git, ok: false } }), 'N/A', 'no readable history');
  assert.equal(v('PRV-03', { git: { ...BASE.git, commitCount: 9 } }), 'MET');
  assert.equal(v('PRV-03', { git: { ...BASE.git, commitCount: 1 } }), 'NOT_MET',
    '⚑ ONE COMMIT IS THE SHALLOW-CLONE CASE TOO. This criterion is why the same repository scores differently depending on how it was fetched, which is worth knowing before a verifier calls an honest proof a forgery.');
});

test('PRV-05 · commit messages say something', () => {
  assert.equal(v('PRV-05', { git: { ...BASE.git, ok: false } }), 'N/A');
  assert.equal(v('PRV-05', { git: { ...BASE.git, subjects: [] } }), 'N/A', 'no subjects to read');
  assert.equal(v('PRV-05', { git: { ...BASE.git, subjects: ['add the parser', 'fix the boundary case'] } }), 'MET');
  assert.equal(v('PRV-05', { git: { ...BASE.git, subjects: ['wip', 'fix', 'stuff', 'updates'] } }), 'NOT_MET',
    '⚑ four commits called wip, fix, stuff and updates are four commits nobody can review');
});

test('⚑ every criterion is reachable in more than one state', () => {
  // The point of the whole file: a criterion that can only ever return one verdict is not a check.
  const alwaysSame = [];
  for (const c of CRITERIA) {
    const seen = new Set();
    for (const ev of [
      BASE,
      { ...BASE, hasSpec: false, hasCI: false, hasReadme: false, hasLicense: false, hasPkg: false, hasAgentCfg: false, tests: [], src: [], testImports: [], testCases: 0, assertions: 0, readmeText: null, pkgAuthor: null, pkgDescription: null, todos: ['a', 'b', 'c'], skips: ['s'], defectMarkers: ['d'], docRunCmds: ['nope'], adrFiles: ['x'], adrBad: ['x'], deps: ['x'], unusedDeps: ['x'], hasLock: false, longDupes: [{ lines: 40 }], git: { ok: false, commitCount: 0, subjects: [], authors: [], fileCount: 0 } },
      { ...BASE, totalLines: 10, tests: [], docFiles: [], git: { ok: true, commitCount: 1, subjects: ['wip'], authors: [], fileCount: 1 } },
    ]) {
      // ⚑ PRV-02 reads the filesystem, so it needs a root that really has no .git — pointing every
      // case at '.' made it look like a constant when it is not.
      const root = seen.size === 0 ? '.' : mkdtempSync(join(tmpdir(), 'acg-reach-'));
      try { seen.add(c.assess({ ...ev, root }).verdict); } catch { seen.add('threw'); }
      finally { if (root !== '.') rmSync(root, { recursive: true, force: true }); }
    }
    if (seen.size < 2) alwaysSame.push(`${c.id} (always ${[...seen][0]})`);
  }
  assert.deepEqual(alwaysSame, [],
    'a criterion with only one reachable verdict is not measuring anything — it is a constant wearing a rubric');
});
