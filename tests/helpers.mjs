// helpers.mjs — the fixture lifecycle every test file shares.
//
// Each file used to open with its own copy of "make an array, define mk, register afterEach", and
// then repeat "build a clean repo, gather it" in every case. That is exactly the two-line repetition
// EVO-01 exists to find, and it found it here — so it is factored out rather than excused.
import test from 'node:test';
import { assess, gather } from '../assessor.mjs';
import { repo, drop, CLEAN } from './fixture.mjs';

/**
 * Bind a fixture builder to automatic cleanup for the calling test file.
 *
 * Every repository built through `mk` is removed after the test that asked for it, whether that test
 * passed or threw — a leaked fixture would otherwise be measured by the next run.
 */
export function fixtures() {
  const perTest = [];
  const perFile = [];
  test.afterEach(() => { while (perTest.length) drop(perTest.pop()); });
  test.after(() => { while (perFile.length) drop(perFile.pop()); });

  const mk = (files = CLEAN, opts = {}) => { const d = repo(files, opts); perTest.push(d); return d; };

  // ⚑ SPEED IS CORRECTNESS HERE. witness bounds every test run at 20 seconds, and that bound applies
  // to the mutants as well as the baseline. A suite slower than the bound does not merely fail to
  // gate: every mutant times out, a timeout counts as KILLED, and the gate reports a FALSE CLEAN.
  // This suite reached 19.8s by rebuilding the same repository — five git subprocesses each — for
  // tests that only ever read it. Built once per file now, and shared by everything read-only.
  const cache = new Map();
  const shared = (key, files = CLEAN, opts = { git: true }) => {
    if (!cache.has(key)) { const d = repo(files, opts); perFile.push(d); cache.set(key, d); }
    return cache.get(key);
  };

  return {
    mk,
    shared,
    /** The one CLEAN repository with real history, reused by every test that only reads it. */
    sharedClean: () => shared('clean'),
    /** Build a repository and return the evidence gather() reads from it. */
    scan: (files = CLEAN, opts = {}) => gather(mk(files, opts)),
    /** Build a repository with real history and return the verdict the assessor reaches on it. */
    judge: (files = CLEAN, opts = { git: true }, threshold) => assess(mk(files, opts), threshold).verdict,
  };
}
