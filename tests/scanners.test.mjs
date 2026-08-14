// scanners.test.mjs — the rules inside gather(), one at a time.
//
// gather() does not just list files: it decides what counts as an abandoned marker, a skipped test, a
// used dependency, a documented command, a wired-up manifest path and a duplicated block. Each of
// those is a small rule with edges, and the edges are where a benchmark quietly starts saying the
// wrong thing about somebody's repository.
//
// The fixture builder gives real files, so each rule is exercised on the text it was written for.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CLEAN, testFile } from './fixture.mjs';
import { fixtures } from './helpers.mjs';

const { scan } = fixtures();
const src = (body) => ({ ...CLEAN, 'src/index.mjs': CLEAN['src/index.mjs'] + '\n' + body });
const TAG = 'TO' + 'DO';                  // built from parts so this file is not itself flagged

test('⚑ a marker counts in TAG context, and not when the word merely appears', () => {
  const ev = scan(src([
    `// ${TAG}: with a colon`,
    `// ${TAG}(someone) with a bracket`,
    `// ${TAG}! with a bang`,
    `// ${TAG} with a space`,
    `// ${TAG}`,
  ].join('\n')));
  assert.equal(ev.todos.length, 5, 'every tag form is a real abandoned subgoal');
});

test('⚑ the marker word is bounded on BOTH sides, so a detector can describe itself', () => {
  // A marker is only a marker when the word stands alone AND is followed by a tag terminator. Both
  // halves earn their keep: without the leading boundary a variable called myTODO is a finding, and
  // without the trailing one an alternation listing the words is four findings. That second case is
  // this file's own subject matter — a tool that defines its markers would fail the criterion for
  // defining them.
  const ev = scan(src([
    `const MARKERS = /${TAG}|FIXME|XXX|HACK/;`,   // alternation: each word is followed by | or /
    `// ${TAG}S remain in the backlog`,           // a plural noun, not a tag
    `// my${TAG}: not a tag either`,              // glued to an identifier
  ].join('\n')));
  assert.equal(ev.todos.length, 0,
    'a word that is part of something else is not an abandoned subgoal');
});

test('the other marker words count too', () => {
  const ev = scan(src(['// FIXME: broken', '// XXX: dubious', '// HACK: temporary'].join('\n')));
  assert.equal(ev.todos.length, 3, 'FIXME, XXX and HACK are the same family');
});

// Every disabled-test form below is assembled from fragments rather than written out. The scanner
// cannot tell a string literal from code and is right not to try, so spelling these in full would
// make THIS file a suite full of skipped tests — the criterion catching its own test, as it already
// did once here.
const SK = 'sk' + 'ip', TD = 'to' + 'do', X = 'x';

test('⚑ every way a test can be switched off is found', () => {
  const ev = scan({
    ...CLEAN,
    'tests/index.test.mjs': testFile(
      `test.${SK}('a', () => v1);`,
      `it.${SK}('b', () => v1);`,
      `describe.${SK}('c', () => v1);`,
      `test.${TD}('d');`,
      `${X}it('e', () => v1);`,
      `${X}describe('f', () => v1);`,
    ),
  });
  assert.equal(ev.skips.length, 6,
    `⚑ ${SK}, ${TD}, ${X}it and ${X}describe are all "written but not run" — catching only .${SK} would miss four of six`);
  assert.ok(ev.skips.every(s => s.file && s.line), 'and each is located, so it can be found and fixed');
});

test('a skip written in another language is still a skip', () => {
  const ev = scan({
    ...CLEAN,
    'tests/py.test.mjs': [
      "import { v1 } from '../src/index.mjs';",
      `// @pytest.mark.${SK}`,
      `// t.S${'k'}ip()`,
      'v1;',
    ].join('\n'),
  });
  assert.equal(ev.skips.length, 2, 'the Python and Go forms count — the rubric is not JavaScript-only');
});

test('⚑ a defect marker in SOURCE is a finding; the same words in a test are not', () => {
  const inSource = scan(src('// BROKEN: this does not work'));
  const inTest = scan({
    ...CLEAN,
    'tests/index.test.mjs': "import { v1 } from '../src/index.mjs';\n// BROKEN: this does not work\nv1;",
  });
  assert.ok(inSource.defectMarkers.length >= 1, 'an admitted defect in shipped source is a known hazard');
  assert.equal(inTest.defectMarkers.length, 0,
    '⚑ but a test describing a broken case is doing its job — counting it would punish honest tests');
});

test('a dependency counts as used however it was imported', () => {
  const pkg = (deps) => JSON.stringify({
    name: 'f', type: 'module', description: 'a real description', author: 'A Real Person',
    dependencies: deps, scripts: { test: 'node --test tests/index.test.mjs' },
  }, null, 2);
  const ev = scan({
    ...CLEAN,
    'package.json': pkg({ alpha: '^1', beta: '^1', gamma: '^1', delta: '^1' }),
    'src/index.mjs': [
      "import a from 'alpha';",
      'const b = require("beta");',
      "import { c } from 'gamma/sub.js';",
      'export const v1 = [a, b, c];',
    ].join('\n'),
  });
  assert.ok(!ev.unusedDeps.includes('alpha'), 'a single-quoted import counts');
  assert.ok(!ev.unusedDeps.includes('beta'), 'a double-quoted require counts');
  assert.ok(!ev.unusedDeps.includes('gamma'), '⚑ and a deep import counts — "gamma/sub.js" is still using gamma');
  assert.ok(ev.unusedDeps.includes('delta'), 'while the one nothing mentions is named');
});

test('⚑ a documented command counts only from a CODE region, never from prose', () => {
  const ev = scan({
    ...CLEAN,
    'README.md': [
      '# A tool',
      '',
      'You will need to make a decision about npm run things before you start.',
      '',
      '```sh',
      'npm run build',
      '```',
    ].join('\n'),
  });
  const names = ev.docRunCmds.map(c => c.name);
  assert.ok(names.includes('build'), 'a command in a fenced block is a command');
  assert.equal(names.length, 1,
    '⚑ and "make a decision" in a sentence is not a make target — reading prose as commands would fail every README that discusses them');
});

test('a design document is not a set of instructions', () => {
  const ev = scan({
    ...CLEAN,
    'docs/design.md': '# Design\n\n```sh\nnpm run something-that-does-not-exist\n```\n',
  });
  assert.equal(ev.docRunCmds.length, 0,
    '⚑ only README-family documents tell a reader what to run — a design note showing an example is not a promise');
});

test('a make target is read from the Makefile', () => {
  const ev = scan({
    ...CLEAN,
    'README.md': '# A tool\n\nRun it:\n\n```sh\nmake build\n```\n',
    'Makefile': '.PHONY: build\nbuild:\n\techo hi\n',
  });
  assert.ok(ev.makeTargets.has('build'), 'the real target is found');
  assert.ok(!ev.makeTargets.has('.PHONY'), '⚑ and .PHONY is a directive, not a target somebody can run');
});

test('⚑ the manifest is read for every place it wires up a file', () => {
  const ev = scan({
    ...CLEAN,
    'package.json': JSON.stringify({
      name: 'f', type: 'module', description: 'a real description', author: 'A Real Person',
      main: './src/index.mjs',
      bin: { tool: './src/cli.mjs' },
      exports: { '.': './src/index.mjs', './extra': './src/extra.mjs' },
      scripts: { test: 'node --test tests/index.test.mjs', build: 'esbuild src/index.mjs --outfile dist/out.js' },
    }, null, 2),
    'src/cli.mjs': 'export const cli = 1;\n',
    'src/extra.mjs': 'export const extra = 1;\n',
  });
  const refs = new Set(ev.manifestRefs);
  assert.ok(refs.has('src/index.mjs'), 'main');
  assert.ok(refs.has('src/cli.mjs'), 'bin');
  assert.ok(refs.has('src/extra.mjs'), '⚑ and a nested exports leaf — a repo can wire its whole surface through exports');
  assert.ok(refs.has('tests/index.test.mjs'), 'and a path named inside a script');
  assert.ok(ev.buildOutputs.has('dist/out.js'),
    '⚑ a declared build output is not a dead pointer — it is generated, and calling it missing would fail every bundled project');
});

test('a script token that is not a path is not a path', () => {
  const ev = scan({
    ...CLEAN,
    'package.json': JSON.stringify({
      name: 'f', type: 'module', description: 'a real description', author: 'A Real Person',
      scripts: { test: 'node --test tests/index.test.mjs', lint: 'eslint --max-warnings 0' },
    }, null, 2),
  });
  assert.ok(!ev.manifestRefs.some(r => r.includes('eslint')), 'a binary is not a file reference');
  assert.ok(!ev.manifestRefs.some(r => /^\d/.test(r)), 'nor is a flag value');
});

test('⚑ an ADR with no status is a decision nobody finished', () => {
  const withStatus = scan({ ...CLEAN, 'docs/adr/0001-choose.md': '# Choose\n\nStatus: Accepted\n\nWe chose.\n' });
  assert.equal(withStatus.adrBad.length, 0, 'an accepted decision is a finished one');

  const heading = scan({ ...CLEAN, 'docs/adr/0001-choose.md': '# Choose\n\n## Status\n\nAccepted\n\nWe chose.\n' });
  assert.equal(heading.adrBad.length, 0, '⚑ and a Status HEADING counts as much as a Status line — the template varies');

  const blank = scan({ ...CLEAN, 'docs/adr/0001-choose.md': '# Choose\n\nStatus: TBD\n\nWe chose.\n' });
  assert.equal(blank.adrBad.length, 1, 'a placeholder status is an unfinished decision');
  assert.match(blank.adrBad[0].text, /TBD/, 'and the placeholder is quoted back');

  const none = scan({ ...CLEAN, 'docs/adr/0001-choose.md': '# Choose\n\nWe chose.\n' });
  assert.equal(none.adrBad.length, 1, 'and no status at all is the same problem');
});

test('⚑ duplication ignores the lines that are the same in every file', () => {
  // Short lines and comment lines are excluded on purpose: `}` appears everywhere, and counting it
  // would make every file in every repository look regenerated.
  const ev = scan({
    ...CLEAN,
    'src/a.mjs': ['}', '}', '}', '// a comment', '// a comment', '// a comment', 'export const a = 1;'].join('\n'),
    'src/b.mjs': ['}', '}', '}', '// a comment', '// a comment', '// a comment', 'export const b = 2;'].join('\n'),
  });
  assert.equal(ev.dupes.filter(d => d.count > 2).length, 0,
    'closing braces and repeated comments are not a regenerated-not-factored signature');
});

test('a genuinely repeated block of real code IS found', () => {
  const block = ['const configuration = { retries: 3, timeout: 1000 };', 'const client = createClient(configuration);'].join('\n');
  const ev = scan({
    ...CLEAN,
    'src/a.mjs': block + '\nexport const a = 1;',
    'src/b.mjs': block + '\nexport const b = 2;',
    'src/c.mjs': block + '\nexport const c = 3;',
  });
  assert.ok(ev.dupes.some(d => d.count >= 3),
    '⚑ the same two substantial lines in three files is the signature this criterion exists to find');
});

test('⚑ a reported duplicate is AT the line it is reported at', () => {
  // The location is the whole value of the finding. Counting position in the filtered array rather
  // than in the file puts every one of these off by however many comments sat above it — a finding
  // that looks actionable, points at unrelated code, and cannot be argued with by the person fixing it.
  const pad = Array.from({ length: 12 }, (_, i) => `// a header comment line ${i}`).join('\n');
  const block = 'const configuration = { retries: 3, timeout: 1000 };\nconst client = createClient(configuration);';
  const ev = scan({
    ...CLEAN,
    'src/a.mjs': `${pad}\n${block}\nexport const a = 1;`,   // block starts at line 13
    'src/b.mjs': `${pad}\n${block}\nexport const b = 2;`,
    'src/c.mjs': `${pad}\n${block}\nexport const c = 3;`,
  });
  const hit = ev.dupes.find(d => d.count >= 3);
  assert.ok(hit, 'precondition: the repeated block is found');
  for (const at of hit.at) assert.equal(at.line, 13,
    `⚑ the block really is on line 13 of ${at.file} — twelve comment lines above it must not shift the answer`);
});

test('⚑ two lines separated by a comment are not a two-line block', () => {
  // Filtering drops comment lines from the array. If the window then closes the gap, the tool
  // reports a pair of adjacent lines that exists in no file — a duplicate of something never written.
  const ev = scan({
    ...CLEAN,
    'src/a.mjs': ['const configuration = { retries: 3, timeout: 1000 };', '// an explanation sits here',
      'const client = createClient(configuration);', 'export const a = 1;'].join('\n'),
    'src/b.mjs': ['const configuration = { retries: 3, timeout: 1000 };', '// a different explanation',
      'const client = createClient(configuration);', 'export const b = 2;'].join('\n'),
    'src/c.mjs': ['const configuration = { retries: 3, timeout: 1000 };', '// and another',
      'const client = createClient(configuration);', 'export const c = 3;'].join('\n'),
  });
  assert.equal(ev.dupes.filter(d => d.count > 2).length, 0,
    'the two statements are never adjacent, so they are not a repeated block');
});

test('⚑ an import header is not duplicated code', () => {
  // Three test files importing the same runner is what a well-organised suite looks like, and the
  // lines cannot be factored out of the files that need them.
  const head = "import test from 'node:test';\nimport assert from 'node:assert/strict';";
  const ev = scan({
    ...CLEAN,
    'tests/a.test.mjs': `${head}\nimport { v1 } from '../src/index.mjs';\ntest('a', () => assert.ok(v1));`,
    'tests/b.test.mjs': `${head}\nimport { v2 } from '../src/index.mjs';\ntest('b', () => assert.ok(v2));`,
    'tests/c.test.mjs': `${head}\nimport { v3 } from '../src/index.mjs';\ntest('c', () => assert.ok(v3));`,
  });
  assert.equal(ev.dupes.filter(d => d.count > 2).length, 0,
    '⚑ otherwise every project with four test files fails this criterion for having four test files');
});

test('⚑ the duplication report is bounded and ordered, so a huge repo cannot flood it', () => {
  const files = { ...CLEAN };
  for (let i = 0; i < 60; i++) {
    files[`src/gen${i}.mjs`] = ['const configuration = { retries: 3, timeout: 1000 };',
      'const client = createClient(configuration);', `export const g${i} = ${i};`].join('\n');
  }
  const ev = scan(files);
  assert.ok(ev.dupes.length <= 50, 'the list is capped');
  const counts = ev.dupes.map(d => d.count);
  assert.deepEqual(counts, [...counts].sort((a, b) => b - a),
    'and sorted worst-first, so the cap keeps the worst rather than an arbitrary fifty');
});
