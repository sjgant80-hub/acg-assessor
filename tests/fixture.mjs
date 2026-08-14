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
    const git = (args) => execFileSync('git', args, {
      cwd: dir, stdio: 'pipe', encoding: 'utf8',
      env: { ...process.env,
        GIT_AUTHOR_NAME: 'Fixture Author', GIT_AUTHOR_EMAIL: 'fixture@example.com',
        GIT_COMMITTER_NAME: 'Fixture Author', GIT_COMMITTER_EMAIL: 'fixture@example.com',
        GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' },
    });
    git(['init', '-q']);
    git(['config', 'user.name', 'Fixture Author']);
    git(['config', 'user.email', 'fixture@example.com']);
    git(['config', 'commit.gpgsign', 'false']);
    for (const subject of (opts.commits || ['add the parser', 'fix the boundary case'])) {
      git(['add', '-A']);
      git(['commit', '-q', '--allow-empty', '-m', subject]);
    }
  }
  return dir;
}

export function drop(dir) {
  rmSync(dir, { recursive: true, force: true });
}

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
  'tests/index.test.mjs': [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import { v1 } from '../src/index.mjs';",
    "test('it works', () => { assert.equal(v1, 1); });",
  ].join('\n') + '\n',
  '.github/workflows/ci.yml': 'name: ci\non: [push]\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n',
};
