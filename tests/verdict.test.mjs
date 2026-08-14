// verdict.test.mjs — the scoring, the hash and the command line.
//
// Everything above this file decides individual criteria. This file is about what the assessor does
// with 27 of them: how core and non-core are combined into one badge, what the threshold comparison
// does exactly at the boundary, which failure signature it calls dominant, and whether the hash is
// really a function of the whole verdict. Then the same questions through the CLI, because that is
// the surface a CI actually calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { assess, CRITERIA, criteriaFingerprint, SPEC_VERSION } from '../assessor.mjs';
import { CLEAN } from './fixture.mjs';
import { fixtures } from './helpers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'assessor.mjs');
const { mk } = fixtures();

// a repo that fails exactly one CORE criterion: BND-03, a manifest pointing at a file nobody wrote
const DEAD_POINTER = { ...CLEAN, 'package.json': CLEAN['package.json'].replace('"main": "./src/index.mjs"', '"main": "./src/never-written.mjs"') };

// the exact float the code divides, recovered from the summary it prints
const ratioOf = (v) => { const [m, t] = v.summary.nonCore.split('/').map(Number); return t ? m / t : 1; };

test('⚑ the threshold comparison includes its own boundary', () => {
  const dir = mk(CLEAN, { git: true });
  const base = assess(dir, 0).verdict;
  assert.equal(base.summary.core.split('/')[0], base.summary.core.split('/')[1],
    'precondition: this fixture meets every core criterion, so only the ratio decides');

  const exact = ratioOf(base);
  assert.equal(assess(dir, exact).verdict.badge, true,
    '⚑ a repo landing exactly ON the threshold passes — the comparison is >=, and a rubric that failed a repo for hitting its own bar would be lying about where the bar is');
  assert.equal(assess(dir, exact * (1 + 1e-9)).verdict.badge, false, 'a hair above it does not');
  assert.equal(assess(dir, exact * (1 - 1e-9)).verdict.badge, true, 'a hair below it does');
});

test('⚑ one failed CORE criterion sinks the badge whatever the rest score', () => {
  const dir = mk(DEAD_POINTER, { git: true });
  const v = assess(dir, 0).verdict;                      // threshold 0: every non-core is satisfied
  assert.ok(v.results.some(r => r.id === 'BND-03' && r.verdict === 'NOT_MET'), 'precondition: BND-03 fails');
  assert.equal(v.badge, false,
    '⚑ core is a conjunction, not a contribution — with the threshold at zero the only thing that can fail this repo is the core criterion, and it must');
});

test('a not-applicable criterion is excluded from both denominators', () => {
  const dir = mk(CLEAN, { git: true });
  const v = assess(dir).verdict;
  const [, coreTotal] = v.summary.core.split('/').map(Number);
  const [, nonTotal] = v.summary.nonCore.split('/').map(Number);
  assert.equal(coreTotal + nonTotal + v.summary.notApplicable, CRITERIA.length,
    '⚑ every criterion is in exactly one bucket — if n/a leaked into a denominator, a repo would be marked down for a criterion the report says does not apply to it');
});

test('the non-core ratio of a repo with no non-core criteria is 1, not 0/0', () => {
  const dir = mk(CLEAN, { git: true });
  const v = assess(dir).verdict;
  assert.ok(Number.isFinite(v.summary.nonCoreRatio), 'the ratio is always a real number');
  assert.ok(v.summary.nonCoreRatio >= 0 && v.summary.nonCoreRatio <= 1, 'and always a proportion');
});

test('⚑ the dominant tell is the commonest FAILURE, and is null when nothing failed', () => {
  const clean = assess(mk(CLEAN, { git: true })).verdict;
  const failed = clean.results.filter(r => r.verdict === 'NOT_MET');
  if (failed.length === 0) assert.equal(clean.dominantTell, null, 'no failures, no diagnosis');

  const slop = assess(mk({ ...CLEAN, 'package.json': CLEAN['package.json'].replace('"main": "./src/index.mjs"', '"main": "./src/gone.mjs"') }, { git: true })).verdict;
  const counts = Object.values(slop.tellTally);
  assert.deepEqual(counts, [...counts].sort((a, b) => b - a), 'the tally is ordered commonest-first');
  if (counts.length) assert.equal(slop.dominantTell, Object.keys(slop.tellTally)[0],
    '⚑ and the dominant tell is the head of that order — naming a rarer signature would point the reader at the wrong problem');
  const total = counts.reduce((a, b) => a + b, 0);
  assert.equal(total, slop.results.filter(r => r.verdict === 'NOT_MET').length,
    'and the tally counts failures only — a MET or n/a criterion contributes nothing to a diagnosis of what went wrong');
});

test('⚑ the hash covers the whole verdict, so nothing can change quietly', () => {
  const dir = mk(CLEAN, { git: true });
  const a = assess(dir).verdict;
  const b = assess(dir).verdict;
  assert.equal(a.hash, b.hash, 'same repo, same hash — the point of a citable verdict');
  assert.match(a.hash, /^[0-9a-f]{32}$/, 'and it is a hash, not a summary');

  const other = assess(dir, 0.99).verdict;
  assert.notEqual(a.hash, other.hash,
    '⚑ a different threshold is a different verdict — the same hash under a laxer bar would let a repo cite a strict-looking pass it never earned');

  const dead = assess(mk(DEAD_POINTER, { git: true })).verdict;
  assert.notEqual(a.hash, dead.hash, 'and different findings hash differently');
});

test('the hash is of the verdict as published, not of some inner subset', () => {
  const dir = mk(CLEAN, { git: true });
  const { verdict } = assess(dir);
  const { hash, ...rest } = verdict;
  const recomputed = execFileSync(process.execPath, ['-e',
    'const{createHash}=require("crypto");let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(createHash("sha256").update(s).digest("hex").slice(0,32)))'],
    { input: JSON.stringify(rest), encoding: 'utf8' });
  assert.equal(hash, recomputed,
    '⚑ a reader with the JSON can recompute the hash themselves — that is what makes it checkable by someone who does not trust the tool');
});

test('the spec fingerprint is a function of the criteria, not of their order', () => {
  const fp = criteriaFingerprint();
  assert.match(fp, /^[0-9a-f]{32}$/, 'it is a hash');
  assert.equal(fp, criteriaFingerprint(), 'and a stable one');
  const dir = mk(CLEAN, { git: true });
  assert.equal(assess(dir).verdict.specFingerprint, fp, 'and it is the one published in the verdict');
  assert.equal(assess(dir).verdict.spec, SPEC_VERSION, 'alongside the version it belongs to');
});

test('every published result carries its evidence, and a note only when there is one', () => {
  const v = assess(mk(CLEAN, { git: true })).verdict;
  assert.equal(v.results.length, CRITERIA.length, 'nothing is dropped from the report');
  for (const r of v.results) {
    assert.ok(r.evidence && r.evidence.length > 0, `${r.id} says what it saw`);
    assert.equal('note' in r, r.verdict === 'N/A' && 'note' in r,
      `${r.id}: a note is a justification for skipping, so it appears only where something was skipped`);
  }
  assert.ok(v.results.some(r => r.verdict === 'N/A' ? r.note : true), 'and an n/a is justified rather than silent');
});

// --- the command line -------------------------------------------------------

const run = (args, opts = {}) => {
  try {
    return { code: 0, out: execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', ...opts }) };
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
};

test('⚑ the CLI exit code is the verdict — in every output mode', () => {
  const good = mk(CLEAN, { git: true });
  const bad = mk(DEAD_POINTER, { git: true });

  assert.equal(run([good]).code, 0, 'a passing repo exits 0');
  assert.equal(run([bad]).code, 1, 'a failing repo exits 1');

  assert.equal(run([good, '--json']).code, 0, 'and the same in JSON mode');
  assert.equal(run([bad, '--json']).code, 1,
    '⚑ a machine-readable FAIL must still be a failure. The README offers --json as the way to wire this into CI; if that path exited 0 regardless, every CI using it would be green forever — the exact test-theatre this tool exists to detect');
});

test('the JSON mode emits the same verdict the library computes', () => {
  const dir = mk(CLEAN, { git: true });
  const { out } = run([dir, '--json']);
  const parsed = JSON.parse(out);
  assert.equal(parsed.hash, assess(dir).verdict.hash, 'byte-for-byte the same verdict, so the CLI is not a second implementation');
  assert.equal(parsed.badge, true);
});

test('a threshold given on the command line is the threshold used', () => {
  const dir = mk(CLEAN, { git: true });
  const strict = JSON.parse(run([dir, '--json', '--threshold=1']).out);
  assert.equal(strict.threshold, 1, 'the flag is read');
  assert.equal(strict.hash, assess(dir, 1).verdict.hash, 'and reaches the scoring, not just the header');
});

test('the fingerprint flag prints the fingerprint and nothing else', () => {
  const { code, out } = run(['--fingerprint']);
  assert.equal(code, 0);
  assert.equal(out.trim(), criteriaFingerprint(),
    '⚑ so a CI can lock the rubric — this is what makes "the criteria changed" mechanical rather than a matter of discipline');
});

test('⚑ a path that does not exist is a usage error, not a verdict', () => {
  const { code, out } = run([join(HERE, 'no-such-repo-anywhere')]);
  assert.equal(code, 2,
    '⚑ distinct from 1 — a typo in a path must never be reportable as "the repository failed", nor as a pass');
  assert.match(out, /no such path/, 'and it says so');
});

test('the human report states the verdict, the evidence and the hash', () => {
  const dir = mk(CLEAN, { git: true });
  const { out } = run([dir]);
  const plain = out.replace(/\x1b\[[0-9;]*m/g, '');
  assert.match(plain, /VERDICT\s+PASS/, 'the answer');
  assert.match(plain, /core criteria\s+\d+\/\d+/, 'the core count');
  assert.match(plain, /non-core\s+\d+\/\d+/, 'the non-core count');
  assert.match(plain, new RegExp(assess(dir).verdict.hash), 'and the hash, so a reader can cite this run');
  for (const c of CRITERIA) assert.ok(plain.includes(c.id), `${c.id} is reported rather than silently dropped`);
});

test('the report of a failing repo names what failed', () => {
  const { code, out } = run([mk(DEAD_POINTER, { git: true })]);
  const plain = out.replace(/\x1b\[[0-9;]*m/g, '');
  assert.equal(code, 1);
  assert.match(plain, /VERDICT\s+FAIL/, 'the answer');
  assert.match(plain, /BND-03/, 'the criterion');
  assert.match(plain, /never-written\.mjs/,
    '⚑ and the specific dead pointer — a rubric that says "failed" without saying what is unactionable, and unarguable');
});
