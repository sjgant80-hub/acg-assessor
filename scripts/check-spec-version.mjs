#!/usr/bin/env node
// Fails if the criteria changed without a SPEC_VERSION bump + re-lock (the REV-03 fix).
// A verdict is only meaningful relative to a stated spec version, so a silent criteria change
// must not be shippable. Run in CI. To land a real criteria change: bump SPEC_VERSION in
// assessor.mjs, then `node scripts/check-spec-version.mjs --write` to record the new fingerprint.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SPEC_VERSION, criteriaFingerprint } from '../assessor.mjs';

const lockPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'spec-lock.json');
const lock = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, 'utf8')) : {};
const current = criteriaFingerprint();

if (process.argv.includes('--write')) {
  lock[SPEC_VERSION] = current;
  writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
  console.log(`locked ${SPEC_VERSION} = ${current}`);
  process.exit(0);
}

const locked = lock[SPEC_VERSION];
if (!locked) {
  console.error(`FAIL  ${SPEC_VERSION} has no entry in spec-lock.json.`);
  console.error(`      A new spec version must record its fingerprint: run with --write.`);
  process.exit(1);
}
if (locked !== current) {
  console.error(`FAIL  criteria changed but ${SPEC_VERSION} was not bumped.`);
  console.error(`      locked  ${locked}`);
  console.error(`      current ${current}`);
  console.error(`      Bump SPEC_VERSION in assessor.mjs, then re-lock with --write.`);
  process.exit(1);
}
console.log(`OK    ${SPEC_VERSION} fingerprint ${current} matches the lock.`);
