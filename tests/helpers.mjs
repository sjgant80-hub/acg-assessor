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
 * Every repository built through the returned helpers is removed after the test that asked for it,
 * whether that test passed or threw — a leaked fixture would otherwise be measured by the next run.
 */
export function fixtures() {
  const made = [];
  test.afterEach(() => { while (made.length) drop(made.pop()); });

  const mk = (files = CLEAN, opts = {}) => { const d = repo(files, opts); made.push(d); return d; };

  return {
    /** Build a repository on disk and return its path. */
    mk,
    /** Build a repository and return the evidence gather() reads from it. */
    scan: (files = CLEAN, opts = {}) => gather(mk(files, opts)),
    /** Build a repository with real history and return the verdict the assessor reaches on it. */
    judge: (files = CLEAN, opts = { git: true }, threshold) => assess(mk(files, opts), threshold).verdict,
  };
}
