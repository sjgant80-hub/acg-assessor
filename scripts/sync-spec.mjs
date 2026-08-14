#!/usr/bin/env node
// Regenerate the criteria section of SPEC.md FROM the criteria the program applies.
//
// ⚑ This exists because SPEC.md was two-thirds stale. It described "Thirteen criteria (v0.2)" while
// the program applied twenty-seven — so fourteen rules, five of them core, could fail a repository
// while appearing nowhere in the published rubric the README sends clients to read. A tool whose
// whole claim is "the rubric is a program" cannot have a prose rubric that says something else.
//
// The section between the markers is generated, never typed. `--check` fails if the file has drifted
// from the program, so the two cannot separate again without CI saying so.
//
//   node scripts/sync-spec.mjs           # rewrite the section from the program
//   node scripts/sync-spec.mjs --check   # fail if it is out of date
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CRITERIA, TELLS, SPEC_VERSION } from '../assessor.mjs';

const START = '<!-- BEGIN GENERATED CRITERIA · edit assessor.mjs, then run scripts/sync-spec.mjs -->';
const END = '<!-- END GENERATED CRITERIA -->';

function render() {
  const core = CRITERIA.filter(c => c.core).length;
  const out = [START, ''];
  out.push(`**${CRITERIA.length} criteria** · ${core} core (marked ●) · spec \`${SPEC_VERSION}\`.`);
  out.push('');
  out.push('This section is generated from the criteria the assessor actually applies. It is not a');
  out.push('description of the program — it is the program\'s own list, rendered. Each entry carries the');
  out.push('tell it detects and the failure it was written from.');
  out.push('');

  let domain = '';
  for (const c of CRITERIA) {
    if (c.domain !== domain) { domain = c.domain; out.push('', `### ${domain}`); }
    const mark = c.core ? ' ●' : '';
    out.push(`- **${c.id}**${mark} (\`${c.tell}\`) — ${c.criterion} *${c.why}*`);
  }

  out.push('');
  out.push('Tells: ' + Object.keys(TELLS).map(t => `\`${t}\``).join(' · ') + '.');
  out.push('');
  out.push('**N/A conditions are not listed here.** They are decided per repository and printed with a');
  out.push('written justification on every run, because whether a criterion applies is a fact about the');
  out.push('repository in front of you, not about the rubric.');
  out.push('');
  out.push(END);
  return out.join('\n');
}

const specPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'SPEC.md');
const current = readFileSync(specPath, 'utf8');
const a = current.indexOf(START), b = current.indexOf(END);
if (a < 0 || b < 0) {
  console.error('FAIL  SPEC.md has no generated-criteria markers. Add them around the criteria section:');
  console.error(`      ${START}`);
  console.error(`      ${END}`);
  process.exit(1);
}

const next = current.slice(0, a) + render() + current.slice(b + END.length);

if (process.argv.includes('--check')) {
  if (next !== current) {
    console.error('FAIL  SPEC.md does not match the criteria the program applies.');
    console.error('      The published rubric and the executable one have drifted.');
    console.error('      Run: node scripts/sync-spec.mjs');
    process.exit(1);
  }
  console.log(`OK    SPEC.md states all ${CRITERIA.length} criteria, as applied.`);
} else {
  writeFileSync(specPath, next);
  console.log(`wrote ${CRITERIA.length} criteria into SPEC.md`);
}
