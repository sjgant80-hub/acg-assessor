import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { assess, gather, criteriaFingerprint, SPEC_VERSION } from '../assessor.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const at = (...p) => join(root, ...p);
const verdictOf = (...rel) => assess(at(...rel)).verdict;

test('determinism — the same repository yields the same verdict hash', () => {
  const first = verdictOf('test-corpus', 'clean-demo').hash;
  const again = verdictOf('test-corpus', 'clean-demo').hash;
  assert.equal(first, again);
});

test('clean-demo passes the rubric', () => {
  assert.equal(verdictOf('test-corpus', 'clean-demo').badge, true);
});

test('slop-demo fails the rubric and names a dominant tell', () => {
  const v = verdictOf('test-corpus', 'slop-demo');
  assert.equal(v.badge, false);
  assert.ok(v.dominantTell, 'a dominant tell is reported on failure');
});

test('the assessor passes its own rubric (eat our own cooking)', () => {
  assert.equal(verdictOf().badge, true);
});

test('VER-01 counts a repo-root test.mjs (konomi single-file convention)', () => {
  const ev = gather(at('test-corpus', 'root-test-demo'));
  assert.ok(
    ev.tests.some(t => /(^|\/)test\.mjs$/.test(t.rel)),
    'a suite named test.mjs at repo root must be recognized as a test'
  );
  // and must NOT be misclassified as source (else VER-05 double-counts it)
  assert.ok(!ev.src.some(s => /(^|\/)test\.mjs$/.test(s.rel)), 'test.mjs is not source');
});

test('the spec fingerprint matches the lock for this version', () => {
  const lock = JSON.parse(readFileSync(at('spec-lock.json'), 'utf8'));
  assert.equal(lock[SPEC_VERSION], criteriaFingerprint());
});
