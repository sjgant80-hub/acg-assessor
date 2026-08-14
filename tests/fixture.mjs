// fixture.mjs — build a real repository on disk, so gather() can be tested against one.
//
// gather() is the half of the assessor that reads the world: it walks the tree, honours ignore files,
// counts lines, finds markers, resolves documentation links, reads the manifest and asks git. None of
// that can be driven with a synthetic object — it needs real files — which is why 89 mutants lived
// there untouched while the criteria themselves were covered.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

/**
 * Create a repository from a plain map of path -> contents.
 *
 * `git: true` makes it a real repository with real commits, because several criteria ask git directly
 * and a stub cannot answer. Commits are made with an explicit identity and date so the fixture is the
 * same on every machine — an assessor whose verdict depends on who ran it would not be a benchmark.
 */
export function repo(files = {}, opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'acg-fx-'));
  for (const [path, body] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  if (opts.git) {
    // `author` lets a test commit under a chosen identity — needed to exercise the placeholder-identity
    // criterion, which asks whether a name OR an email is a known unconfigured-git default. Testing
    // that properly means committing as "Your Name <real@example.com>" and as the reverse.
    const who = opts.author || { name: 'Fixture Author', email: 'fixture@example.com' };
    const git = (args) => execFileSync('git', args, {
      cwd: dir, stdio: 'pipe', encoding: 'utf8',
      env: { ...process.env,
        GIT_AUTHOR_NAME: who.name, GIT_AUTHOR_EMAIL: who.email,
        GIT_COMMITTER_NAME: who.name, GIT_COMMITTER_EMAIL: who.email,
        GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' },
    });
    // The identity comes from the GIT_* environment above, so the three `git config` calls this used
    // to make are redundant — and a git subprocess is the dominant cost of a fixture. Signing is
    // disabled per-command instead, for the same reason. See the timing note in helpers.mjs: the
    // suite has to stay well inside the mutation gate's per-run bound or the gate cannot run at all.
    git(['init', '-q']);
    for (const subject of (opts.commits || ['add the parser', 'fix the boundary case'])) {
      git(['add', '-A']);
      git(['-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', subject]);
    }
  }
  return dir;
}

export function drop(dir) {
  rmSync(dir, { recursive: true, force: true });
}

/**
 * A test file for a fixture repository: the usual preamble, then whatever the case is really about.
 *
 * The preamble is here rather than written out at each call site because EVO-01 caught it — three
 * fixtures opening with the same two import lines is the repetition that criterion looks for, and
 * excusing it in the tool's own test fixtures would be the exact thing the tool exists to refuse.
 */
export const testFile = (...body) => [
  "import test from 'node:test';",
  "import assert from 'node:assert/strict';",
  "import { v1 } from '../src/index.mjs';",
  ...body,
].join('\n') + '\n';

/** A repository that meets everything, as the baseline other fixtures deviate from. */
export const CLEAN = {
  'README.md': '# A real tool\n\nIt does a real thing, described here at length so nothing reads as a placeholder.\n',
  'LICENSE': 'MIT\n',
  'package.json': JSON.stringify({
    name: 'fixture', version: '1.0.0', type: 'module',
    description: 'a real description of a real thing',
    author: 'A Real Person', main: './src/index.mjs',
    scripts: { test: 'node --test tests/index.test.mjs' },
  }, null, 2) + '\n',
  'CLAUDE.md': 'Instructions for the agent working in this repository.\n',
  'docs/design.md': '# Design\n\nHow it works.\n',
  'src/index.mjs': Array.from({ length: 60 }, (_, i) => `export const v${i} = ${i};`).join('\n') + '\n',
  'tests/index.test.mjs': testFile("test('it works', () => { assert.equal(v1, 1); });"),
  '.github/workflows/ci.yml': 'name: ci\non: [push]\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n',
};
