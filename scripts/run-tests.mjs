#!/usr/bin/env node
// Run the suite, and refuse to call it green unless it actually RAN.
//
// ⚑ This exists because of a mutant no test could catch. The last line of assessor.mjs is
//
//     if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
//
// which decides "am I being run as a command, or imported?". Invert that comparison and the answer
// is backwards: importing the module runs the CLI. The test runner imports it, main() assesses the
// repository, prints a report, and calls process.exit(0) — and the process is gone before a single
// test executes. `node --test` exits 0. Every mutant after that reads as killed.
//
// No assertion inside the suite can catch this: the process dies before the assertions exist. The
// check has to be outside, and it has to be about the RUN rather than about the results. So: parse
// the test count out of the runner's own output and fail if the suite did not run.
//
// The general rule this encodes — a green means nothing unless you know how much ran to earn it.
import { spawnSync } from 'node:child_process';

// The floor is deliberately far below the real count. It is here to catch "the suite did not run",
// not to police growth, and a floor that has to be edited with every new test would just get raised
// on autopilot until it stopped meaning anything.
const MIN_TESTS = 60;

const FILES = [
  'tests/assessor.test.mjs',
  'tests/criteria.test.mjs',
  'tests/gather.test.mjs',
  'tests/scanners.test.mjs',
  'tests/verdict.test.mjs',
  'tests/detect.test.mjs',
  'tests/evidence.test.mjs',
  'tests/boundaries.test.mjs',
];

const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...FILES], { encoding: 'utf8' });
process.stdout.write(r.stdout || '');
process.stderr.write(r.stderr || '');

const out = (r.stdout || '') + (r.stderr || '');
const ran = Number((out.match(/^# tests (\d+)$/m) || [])[1] ?? NaN);
const failed = Number((out.match(/^# fail (\d+)$/m) || [])[1] ?? NaN);

if (!Number.isFinite(ran)) {
  console.error('\nFAIL  the test runner produced no test count — the suite did not report running.');
  process.exit(1);
}
if (ran < MIN_TESTS) {
  console.error(`\nFAIL  only ${ran} test(s) ran; at least ${MIN_TESTS} were expected.`);
  console.error('      A suite that exits before running is not a passing suite.');
  process.exit(1);
}
if (failed > 0 || r.status !== 0) {
  console.error(`\nFAIL  ${failed} test(s) failed.`);
  process.exit(1);
}
console.log(`\nOK    ${ran} tests ran, ${failed} failed.`);
