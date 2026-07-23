// A repo-root suite named exactly `test.mjs` (konomi convention). It imports its
// own source and asserts — a genuine test that older VER-01 detection missed
// because the basename has no separator before "test" and lives in no test/ dir.
import assert from 'node:assert/strict';
import { add, mul } from './index.mjs';

assert.equal(add(2, 3), 5);
assert.equal(mul(2, 3), 6);
console.log('ok');
