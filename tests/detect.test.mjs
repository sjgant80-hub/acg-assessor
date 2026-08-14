// detect.test.mjs — what the assessor recognises, and what it refuses to.
//
// Before any criterion can judge a repository, gather() has to decide what it is looking at: whether
// that file is a licence, whether this project has CI, whether a path in a link points at anything,
// whether a line is a test case or an assertion. Each of those is a pattern, and a pattern that is
// slightly too eager or slightly too narrow does not throw — it quietly changes somebody's verdict.
//
// These are the recognisers the other test files drive past on their way to the criteria.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CLEAN, testFile } from './fixture.mjs';
import { fixtures } from './helpers.mjs';

const { scan } = fixtures();
const without = (...keys) => { const f = { ...CLEAN }; for (const k of keys) delete f[k]; return f; };

test('a licence is a licence however it is spelled', () => {
  assert.ok(scan({ ...without('LICENSE'), 'LICENCE': 'MIT\n' }).hasLicense,
    '⚑ the British spelling counts — half the estate writes it that way, and a rubric that failed them for it would be wrong about the repository, not about the spelling');
  assert.ok(scan({ ...without('LICENSE'), 'LICENSE.md': 'MIT\n' }).hasLicense, 'and an extension makes no difference');
  assert.ok(!scan(without('LICENSE')).hasLicense, 'while a repo with none is reported as having none');
});

test('⚑ CI is recognised on every forge the assessor claims to support', () => {
  // The detectors name GitLab, Travis and CircleCI explicitly, so the intent is not in doubt. The
  // walk skipped every dot-named entry except .github, which made all three unreachable: a GitLab
  // project running a full pipeline scored "no CI", and because VER-06 is CORE it could never earn
  // the badge at all, whatever its pipeline did. A stated capability the code cannot deliver.
  const base = without('.github/workflows/ci.yml');
  assert.ok(scan(CLEAN).hasCI, 'GitHub Actions');
  assert.ok(scan({ ...base, '.gitlab-ci.yml': 'test:\n  script: npm test\n' }).hasCI, 'GitLab');
  assert.ok(scan({ ...base, '.travis.yml': 'script: npm test\n' }).hasCI, 'Travis');
  assert.ok(scan({ ...base, '.circleci/config.yml': 'jobs:\n  t:\n    steps:\n      - run: npm test\n' }).hasCI, 'CircleCI');
  assert.ok(!scan(base).hasCI,
    'and a repo with no automation at all is not credited — this criterion is the difference between "the tests pass" and "the tests passed once on someone\'s laptop"');
});

test('⚑ and the CI text those criteria read is the pipeline, not an empty string', () => {
  // VER-06 asks whether CI invokes a test runner. It reads ev.ciText. If the pipeline file was never
  // walked, ciText is empty, the answer is "no", and the criterion is core.
  const base = without('.github/workflows/ci.yml');
  assert.match(scan({ ...base, '.gitlab-ci.yml': 'test:\n  script: npm test\n' }).ciText, /npm test/,
    'a GitLab pipeline that runs the tests must be visible to the criterion that asks whether CI runs the tests');
  assert.match(scan({ ...base, '.circleci/config.yml': 'jobs:\n  t:\n    steps:\n      - run: npm test\n' }).ciText, /npm test/, 'and a CircleCI one');
});

test('a lockfile is recognised for each ecosystem that has one', () => {
  for (const name of ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'poetry.lock', 'Cargo.lock', 'go.sum']) {
    assert.ok(scan({ ...CLEAN, [name]: 'lock\n' }).hasLock, `${name} pins versions`);
  }
  assert.ok(!scan(CLEAN).hasLock, 'and nothing else does');
});

test('committed agent instructions are found under the name each tool uses', () => {
  const base = without('CLAUDE.md');
  for (const name of ['CLAUDE.md', 'AGENTS.md', '.cursorrules', 'copilot-instructions.md']) {
    assert.ok(scan({ ...base, [name]: 'instructions\n' }).hasAgentCfg, `${name} is agent configuration`);
  }
  assert.ok(!scan(base).hasAgentCfg, 'and a repo with none is reported as having none');
});

test('a durable spec is found by directory or by name', () => {
  const bare = without('docs/design.md');
  assert.ok(scan(CLEAN).hasSpec, 'a docs directory holds the durable record');
  assert.ok(scan({ ...bare, 'DESIGN.md': '# Design\n' }).hasSpec, 'and so does a file named for one');
  assert.ok(scan({ ...bare, 'RFC-001.md': '# RFC\n' }).hasSpec, 'or an RFC');
  assert.ok(!scan(bare).hasSpec, 'while a repo with neither has no durable record of intent');
});

test('⚑ the path set holds directories, not only files', () => {
  const ev = scan({ ...CLEAN, 'src/deep/nested/thing.mjs': 'export const t = 1;\n' });
  assert.ok(ev.pathSet.has('src/deep/nested/thing.mjs'), 'the file');
  assert.ok(ev.pathSet.has('src/deep/nested'), 'its directory');
  assert.ok(ev.pathSet.has('src/deep'), 'and every ancestor');
  assert.ok(ev.pathSet.has('src'),
    '⚑ so a documentation link pointing at a FOLDER resolves — otherwise every "see [the source](src/)" in every README is reported as a dead link');
});

test('⚑ a link inside a code block is an example, not a promise', () => {
  // A README that documents markdown syntax, or shows a snippet containing a link, is not claiming
  // those files exist. Reading them as links makes documenting your own format a rubric failure.
  const ev = scan({
    ...CLEAN,
    'README.md': [
      '# A tool',
      '',
      'A real link: [the design](docs/design.md)',
      '',
      'Write links like `[label](path/to/nowhere.md)` in your notes.',
      '',
      '```md',
      '[an example](also/not/real.md)',
      '```',
    ].join('\n'),
  });
  const targets = ev.docLinks.filter(l => l.file === 'README.md').map(l => l.target);
  assert.deepEqual(targets, ['docs/design.md'],
    '⚑ only the real link is recorded — the fenced one and the backticked one are text about links');
});

test('a link target is recorded as a path, without its decoration', () => {
  const ev = scan({
    ...CLEAN,
    'README.md': '# A tool\n\n[angle](<docs/design.md>) and [titled](docs/design.md "the design")\n',
  });
  const targets = ev.docLinks.filter(l => l.file === 'README.md').map(l => l.target);
  assert.deepEqual(targets, ['docs/design.md', 'docs/design.md'],
    'angle brackets and a link title are syntax, not part of the path that has to resolve');
});

test('⚑ a test case is counted in the language it was written in', () => {
  const ev = scan({
    ...CLEAN,
    'tests/index.test.mjs': testFile("test('a', () => { assert.ok(1); });", "it('b', () => { assert.ok(1); });"),
    'tests/py_test.py': 'def test_one():\n    assert compute() == 3\n',
    'tests/Thing_test.go': 'func TestThing(t *testing.T) {\n  t.Error("no")\n}\n',
  });
  assert.ok(ev.testCases >= 4, `four declarations across three languages, saw ${ev.testCases}`);
});

test("⚑ Python's assert statement is an assertion", () => {
  // VER-07 (CORE) asks that assertions number at least as many as test cases. `def test_` was counted
  // as a case, but the assertion pattern required a `(` or `.` after the word — which idiomatic
  // Python never has. So a real Python suite scored cases without assertions and failed a core
  // criterion for being written in Python.
  const ev = scan({
    ...without('tests/index.test.mjs'),   // the Python suite is the whole suite here, so the count is its own
    'tests/py_test.py': ['def test_one():', '    assert compute() == 3', '',
      'def test_two():', '    assert other() is True'].join('\n'),
  });
  assert.equal(ev.testCases, 2, 'two cases');
  assert.ok(ev.assertions >= 2,
    `⚑ and two assertions — saw ${ev.assertions}. A suite that asserts in the ordinary way for its language must not read as a suite that asserts nothing`);
});

test('but importing an assertion library still is not asserting', () => {
  const ev = scan({
    ...CLEAN,
    'tests/index.test.mjs': ["import assert from 'node:assert/strict';", "test('a', () => { doThing(); });"].join('\n'),
  });
  assert.equal(ev.assertions, 0, 'the import line is not a check — the Python fix must not open that door');
});

test('⚑ require() is not an assertion, however much it looks like a call', () => {
  // Node's assert is often pulled in with require, and an early version counted that as an assertion.
  // A suite of twenty cases and one require would then look fully asserted.
  const ev = scan({
    ...CLEAN,
    'tests/index.test.mjs': [
      "const assert = require('node:assert');",
      "const helper = require('./helper.js');",
      "test('does a thing', () => { helper(); });",
    ].join('\n'),
  });
  assert.equal(ev.assertions, 0,
    '⚑ importing an assertion library is not making an assertion — counting it would let a suite that verifies nothing satisfy the criterion that exists to catch exactly that');
  assert.equal(ev.testCases, 1, 'while the case itself is counted');
});

test('⚑ a suite named as the whole test file is still a suite', () => {
  // The konomi single-file convention: one `test.mjs` at the repository root. An earlier pattern
  // required a separator (foo.test.mjs) or a tests/ directory, so a dozen repositories with real,
  // running tests were scored as having none.
  const ev = scan({ ...without('tests/index.test.mjs'), 'test.mjs': testFile("test('it works', () => assert.ok(1));") });
  assert.equal(ev.tests.length, 1, 'a root test.mjs is the test suite');
  assert.ok(!ev.src.includes(ev.tests[0]),
    'and it is not ALSO counted as source — double-counting it would let a repo satisfy the source-import criterion against itself');
});

test('and a file that merely ends in those letters is not', () => {
  const ev = scan({ ...CLEAN, 'src/latest.mjs': 'export const a = 1;\n', 'src/contest.mjs': 'export const b = 1;\n' });
  const rels = ev.tests.map(t => t.rel);
  assert.ok(!rels.includes('src/latest.mjs'), '"latest" is not "test"');
  assert.ok(!rels.includes('src/contest.mjs'), 'nor is "contest"');
});

test('an author given as an object is read as the person, not the object', () => {
  const pkg = JSON.parse(CLEAN['package.json']);
  pkg.author = { name: 'A Real Person', email: 'real@example.com' };
  const ev = scan({ ...CLEAN, 'package.json': JSON.stringify(pkg, null, 2) });
  assert.equal(ev.pkgAuthor, 'A Real Person',
    'npm allows both forms, and a repo should not fail the ownership criterion for using the structured one');
});

test('declared dependencies are reported in a fixed order', () => {
  const pkg = JSON.parse(CLEAN['package.json']);
  pkg.dependencies = { zulu: '^1', alpha: '^1', mike: '^1' };
  const ev = scan({ ...CLEAN, 'package.json': JSON.stringify(pkg, null, 2) });
  assert.deepEqual(ev.deps, ['alpha', 'mike', 'zulu'],
    '⚑ sorted — the verdict is hashed, and a hash that depends on key order in someone\'s manifest is not reproducible');
});

test('⚑ a malformed manifest does not stop the assessment', () => {
  const ev = scan({ ...CLEAN, 'package.json': '{ this is not json' });
  assert.ok(Array.isArray(ev.deps) && ev.deps.length === 0, 'nothing is claimed about dependencies that could not be read');
  assert.ok(ev.files.length > 0,
    '⚑ and the rest of the repository is still assessed — a broken manifest is a finding to report, not a reason to return nothing');
});

test('a test file is credited with importing its own source, whichever syntax it used', () => {
  const ev = scan({
    ...CLEAN,
    'tests/index.test.mjs': [
      "import { v1 } from '../src/index.mjs';",
      "const helper = require('../src/helper.js');",
      "import '../src/side-effect.mjs';",
      "test('a', () => { v1; helper; });",
    ].join('\n'),
  });
  const specs = ev.testImports.map(i => i.spec);
  assert.ok(specs.includes('../src/index.mjs'), 'a named import');
  assert.ok(specs.includes('../src/helper.js'), 'a require');
  assert.ok(specs.includes('../src/side-effect.mjs'), 'and a bare import for its side effect');
});
