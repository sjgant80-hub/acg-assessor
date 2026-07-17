#!/usr/bin/env node
/**
 * THE ASSESSOR  ·  deterministic rubric assessment for AI-assisted codebases
 *
 * The rubric's whole test (Appendix A): "two independent assessors examining the
 * same repository would reach substantially the same verdict."
 *
 * Two humans diverge. A program cannot. Same input -> same verdict -> same hash.
 * Inter-assessor agreement: 1.00, by construction.
 *
 * Scoring: BINARY with explicit N/A and a published threshold. No grading.
 * ("The moment 'partially meets' exists, two assessors diverge.")
 *
 * Zero dependencies. Vanilla Node. MIT.
 *
 *   node assessor.mjs <path> [--json] [--threshold=0.7] [--fingerprint]
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname, relative, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// SPEC VERSION  ·  changes to criteria MUST bump this. A verdict is only
// meaningful relative to a stated spec version. Enforced by spec-lock.json +
// scripts/check-spec-version.mjs (the REV-03 fix).
// ---------------------------------------------------------------------------
const SPEC_VERSION = 'assessor-v0.2';
const DEFAULT_THRESHOLD = 0.70;   // published. non-core criteria proportion required.

const MET = 'MET', NOT_MET = 'NOT_MET', NA = 'N/A';

// ---------------------------------------------------------------------------
// THE SEVEN TELLS  ·  behavioural signatures of agent-generated code.
// Each one exists because it was watched go wrong, not because a framework said so.
// ---------------------------------------------------------------------------
const TELLS = {
  UNSPENT:   'declared and never used (deps, imports, exports)',
  UNOPENED:  'code paths with no test that exercises them',
  REPEAT:    'near-identical blocks regenerated rather than factored',
  PASSED:    'tests skipped, pending, or always-true',
  COLLAPSED: 'abandoned subgoals left in place (TODO/FIXME/XXX)',
  ECHOED:    'scaffold/boilerplate retained unmodified',
  INERT:     'unreachable or no-op code'
};

// ---------------------------------------------------------------------------
// FILE WALK  ·  deterministic order. sorted. no fs-order dependence.
// rel paths are normalised to forward slashes so criteria match on any OS.
// ---------------------------------------------------------------------------
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', 'vendor']);
const CODE_EXT  = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.go', '.rs', '.java', '.rb']);

// .assessorignore  ·  gitignore-style prefixes the assessor must not scan (test
// fixtures, vendored corpora). Lets the assessor assess its OWN source without
// scanning the deliberately-broken demo repos it ships as its regression suite.
function loadIgnore(root) {
  const f = join(root, '.assessorignore');
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8').split('\n').map(l => l.trim())
    .filter(l => l && !l.startsWith('#')).map(l => l.replace(/\/+$/, ''));
}
const ignored = (rel, ignore) => ignore.some(p => rel === p || rel.startsWith(p + '/'));

function walk(dir, root, ignore, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries.sort()) {                 // sorted -> deterministic
    if (name.startsWith('.') && name !== '.github') continue;
    const full = join(dir, name);
    const rel = relative(root, full).replace(/\\/g, '/');   // forward slashes on every OS
    if (ignored(rel, ignore)) continue;
    let st; try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      walk(full, root, ignore, out);
    } else {
      out.push({ path: full, rel, ext: extname(name), name, size: st.size });
    }
  }
  return out;
}

function read(f) { try { return readFileSync(f.path, 'utf8'); } catch { return ''; } }

// ---------------------------------------------------------------------------
// EVIDENCE  ·  gathered ONCE, deterministically. criteria read from this.
// ---------------------------------------------------------------------------
function gather(root) {
  const files = walk(root, root, loadIgnore(root));
  const code  = files.filter(f => CODE_EXT.has(f.ext));
  const tests = code.filter(f => /(\.|_|\/)(test|spec)\.|(^|\/)(tests?|__tests__|spec)\//i.test(f.rel));
  const src   = code.filter(f => !tests.includes(f));

  const ev = {
    root, files, code, tests, src,
    totalLines: 0, todos: [], skips: [], longFns: [], dupes: [],
    hasLicense: files.some(f => /^licen[cs]e/i.test(f.name)),
    hasReadme:  files.some(f => /^readme/i.test(f.name)),
    hasCI:      files.some(f => /\.github\/workflows\//.test(f.rel) || /^\.?(gitlab-ci|travis|circleci)/i.test(f.name)),
    hasLock:    files.some(f => /^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Cargo\.lock|go\.sum)$/.test(f.name)),
    hasPkg:     files.some(f => f.name === 'package.json'),
    hasSpec:    files.some(f => /^(spec|SPEC|design|DESIGN|adr|ADR|rfc|RFC)/.test(f.name) || /\/(docs?|adr|rfc)\//i.test(f.rel)),
    hasAgentCfg:files.some(f => /^(\.cursorrules|claude\.md|CLAUDE\.md|\.aider\.conf\.yml|copilot-instructions\.md|AGENTS?\.md)$/i.test(f.name)),
    deps: [], usedDeps: new Set()
  };

  // package.json declared deps
  const pkgFile = files.find(f => f.name === 'package.json');
  if (pkgFile) {
    try {
      const pkg = JSON.parse(read(pkgFile));
      ev.deps = Object.keys(pkg.dependencies || {}).sort();
      ev.pkgScripts = Object.keys(pkg.scripts || {}).sort();
    } catch { /* malformed package.json is itself a finding, handled by SPEC-01 */ }
  }

  // single pass over code
  const blockHashes = new Map();
  for (const f of code) {
    const text = read(f);
    const lines = text.split('\n');
    ev.totalLines += lines.length;

    lines.forEach((line, i) => {
      // a marker counts only in TAG context (TODO:, TODO(, TODO!, TODO<space/eol>) — NOT when the
      // words merely appear inside a '/'- or '|'-delimited list, e.g. the detector's own definition.
      if (/(^|[^A-Za-z0-9_])(TODO|FIXME|XXX|HACK)(:|\(|!|\s|$)/.test(line))
        ev.todos.push({ file: f.rel, line: i + 1, text: line.trim().slice(0, 100) });
      if (/\b(it|test|describe)\.(skip|todo)\b|\bxit\b|\bxdescribe\b|@pytest\.mark\.skip|t\.Skip\(/.test(line))
        ev.skips.push({ file: f.rel, line: i + 1, text: line.trim().slice(0, 100) });
    });

    // dependency usage
    for (const d of ev.deps) {
      if (text.includes(`'${d}'`) || text.includes(`"${d}"`) || text.includes(`from '${d}`) || text.includes(`require('${d}`))
        ev.usedDeps.add(d);
    }

    // REPEAT: normalised 2-line window hashing -> regenerated-not-factored signature
    const norm = lines.map(l => l.replace(/\s+/g, ' ').trim()).filter(l => l.length > 12 && !/^(\/\/|#|\*)/.test(l));
    for (let i = 0; i + 2 <= norm.length; i++) {
      const block = norm.slice(i, i + 2).join("\n");
      const h = createHash('sha256').update(block).digest('hex').slice(0, 16);
      if (!blockHashes.has(h)) blockHashes.set(h, []);
      blockHashes.get(h).push({ file: f.rel, line: i + 1 });
    }
  }
  ev.dupes = [...blockHashes.entries()]
    .filter(([, hits]) => hits.length > 1)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, 50)
    .map(([h, hits]) => ({ hash: h, count: hits.length, at: hits.slice(0, 3) }));

  ev.unusedDeps = ev.deps.filter(d => !ev.usedDeps.has(d));
  return ev;
}

// ---------------------------------------------------------------------------
// THE CRITERIA  ·  stable IDs, never reused. six domains.
// Each: id, domain, criterion (observable), why (from a real failure), tell,
//       core (must pass for badge), assess(ev) -> {verdict, evidence, note?}
// ---------------------------------------------------------------------------
const CRITERIA = [

  // ---- SPECIFICATION INTEGRITY -------------------------------------------
  {
    id: 'SPEC-01', domain: 'specification integrity', core: true, tell: 'COLLAPSED',
    criterion: 'A written specification, design note, or ADR exists and is version-controlled alongside the code.',
    why: 'Agents generate from a prompt that is discarded. Without a durable spec, no one can say what the code was supposed to do, so no one can say whether it is wrong.',
    assess: ev => ev.hasSpec
      ? { verdict: MET, evidence: 'spec/design/ADR/docs directory present in tree' }
      : { verdict: NOT_MET, evidence: 'no spec, design note, ADR, or docs directory found' }
  },
  {
    id: 'SPEC-02', domain: 'specification integrity', core: false, tell: 'COLLAPSED',
    criterion: 'Abandoned subgoal markers (TODO/FIXME/XXX/HACK) number fewer than 1 per 200 lines of code.',
    why: 'Agents open subgoals and do not close them. Marker density is the most direct measure of intent that was started and dropped.',
    assess: ev => {
      if (ev.totalLines < 30) return { verdict: NA, evidence: "codebase under 30 lines", note: "insufficient code to assess density" };
      const rate = ev.todos.length / (ev.totalLines / 200);
      return rate < 1
        ? { verdict: MET, evidence: `${ev.todos.length} markers across ${ev.totalLines} lines (${rate.toFixed(2)}/200)` }
        : { verdict: NOT_MET, evidence: `${ev.todos.length} markers across ${ev.totalLines} lines (${rate.toFixed(2)}/200)`, sample: ev.todos.slice(0, 5) };
    }
  },

  // ---- VERIFICATION INTEGRITY --------------------------------------------
  {
    id: 'VER-01', domain: 'verification integrity', core: true, tell: 'UNOPENED',
    criterion: 'The repository contains tests.',
    why: 'The single most common finding. Generated code arrives confident and unexercised. Absence of tests is not a maturity level, it is an unassessable codebase.',
    assess: ev => ev.tests.length > 0
      ? { verdict: MET, evidence: `${ev.tests.length} test file(s)` }
      : { verdict: NOT_MET, evidence: 'no test files found' }
  },
  {
    id: 'VER-02', domain: 'verification integrity', core: true, tell: 'PASSED',
    criterion: 'No test is skipped, pending, or disabled without an adjacent written justification.',
    why: 'A skipped test is a failing test with the alarm removed. Agents skip a test to make the suite green and report success.',
    assess: ev => {
      if (ev.tests.length === 0) return { verdict: NA, evidence: 'no tests present', note: 'VER-01 not met; nothing to skip' };
      return ev.skips.length === 0
        ? { verdict: MET, evidence: 'no skipped/pending tests detected' }
        : { verdict: NOT_MET, evidence: `${ev.skips.length} skipped/pending test(s)`, sample: ev.skips.slice(0, 5) };
    }
  },
  {
    id: 'VER-03', domain: 'verification integrity', core: false, tell: 'UNOPENED',
    criterion: 'Test files number at least 1 per 4 source files.',
    why: 'Not a coverage metric. A ratio this coarse only catches the case where tests were written for the demo path and nothing else.',
    assess: ev => {
      if (ev.src.length === 0) return { verdict: NA, evidence: 'no source files', note: 'nothing to test' };
      const ratio = ev.tests.length / ev.src.length;
      return ratio >= 0.25
        ? { verdict: MET, evidence: `${ev.tests.length} test / ${ev.src.length} src (${ratio.toFixed(2)})` }
        : { verdict: NOT_MET, evidence: `${ev.tests.length} test / ${ev.src.length} src (${ratio.toFixed(2)}) — below 0.25` };
    }
  },
  {
    id: 'VER-04', domain: 'verification integrity', core: false, tell: 'UNOPENED',
    criterion: 'An automated check runs on every change (CI configuration present).',
    why: 'Without CI, "the tests pass" means one person ran them once on one machine. Agent-assisted teams ship faster than manual verification can follow.',
    assess: ev => ev.hasCI
      ? { verdict: MET, evidence: 'CI configuration present' }
      : { verdict: NOT_MET, evidence: 'no CI workflow found' }
  },

  // ---- AGENT BOUNDARIES ---------------------------------------------------
  {
    id: 'BND-01', domain: 'agent boundaries', core: false, tell: 'ECHOED',
    criterion: 'Agent instructions/configuration are committed to the repository.',
    why: 'If the agent is steered by a file on one developer\'s machine, the build is not reproducible and the agent\'s constraints are not reviewable.',
    assess: ev => ev.hasAgentCfg
      ? { verdict: MET, evidence: 'committed agent instruction file found' }
      : { verdict: NOT_MET, evidence: 'no committed agent instruction/config file', note: 'N/A if no agents are used in this codebase — assessor must justify' }
  },
  {
    id: 'BND-02', domain: 'agent boundaries', core: false, tell: 'UNSPENT',
    criterion: 'Every declared runtime dependency is imported somewhere in the source.',
    why: 'Agents add dependencies speculatively and abandon the approach. Each unused dependency is unreviewed third-party code inside the trust boundary for no benefit.',
    assess: ev => {
      if (!ev.hasPkg) return { verdict: NA, evidence: 'no package.json', note: 'dependency manifest not in a format this assessor reads' };
      if (ev.deps.length === 0) return { verdict: MET, evidence: 'zero declared runtime dependencies' };
      return ev.unusedDeps.length === 0
        ? { verdict: MET, evidence: `all ${ev.deps.length} declared dependencies referenced` }
        : { verdict: NOT_MET, evidence: `${ev.unusedDeps.length} declared but unreferenced: ${ev.unusedDeps.slice(0, 8).join(', ')}` };
    }
  },

  // ---- HUMAN ACCOUNTABILITY -----------------------------------------------
  {
    id: 'ACC-01', domain: 'human accountability', core: true, tell: 'ECHOED',
    criterion: 'A README states what the system is for and how to run it.',
    why: 'The cheapest possible test of whether a human ever owned this. Generated repositories routinely have none, or have one describing a template.',
    assess: ev => ev.hasReadme
      ? { verdict: MET, evidence: 'README present' }
      : { verdict: NOT_MET, evidence: 'no README found' }
  },
  {
    id: 'ACC-02', domain: 'human accountability', core: false, tell: 'ECHOED',
    criterion: 'A licence file is present.',
    why: 'Legal accountability is the floor of human accountability. Its absence usually means nobody made a decision about the code, they just accepted output.',
    assess: ev => ev.hasLicense
      ? { verdict: MET, evidence: 'licence file present' }
      : { verdict: NOT_MET, evidence: 'no licence file' }
  },

  // ---- EVOLVABILITY -------------------------------------------------------
  {
    id: 'EVO-01', domain: 'evolvability', core: false, tell: 'REPEAT',
    criterion: 'No two-line normalised code block is repeated more than twice across the codebase.',
    why: 'The signature finding of agent-maintained code. An agent asked for a similar feature regenerates rather than factors. Each copy then diverges, and a fix applied to one is not applied to the others.',
    assess: ev => {
      if (ev.totalLines < 30) return { verdict: NA, evidence: "codebase under 30 lines", note: "insufficient code to assess duplication" };
      const bad = ev.dupes.filter(d => d.count > 2);
      return bad.length === 0
        ? { verdict: MET, evidence: `no block repeated more than twice (${ev.dupes.length} appear exactly twice)` }
        : { verdict: NOT_MET, evidence: `${bad.length} block(s) repeated 3+ times (worst: ${bad[0].count}x)`, sample: bad.slice(0, 3) };
    }
  },

  // ---- PROVENANCE ---------------------------------------------------------
  {
    id: 'PRV-01', domain: 'provenance', core: true, tell: 'UNSPENT',
    criterion: 'Dependency versions are pinned by a committed lockfile.',
    why: 'Without a lock, the code that was assessed is not the code that will run. Provenance is the claim that this artefact is the one that was reviewed.',
    assess: ev => {
      if (!ev.hasPkg) return { verdict: NA, evidence: 'no package.json', note: 'ecosystem not read by this assessor version' };
      if (ev.deps.length === 0 && !ev.hasLock) return { verdict: NA, evidence: 'zero dependencies declared', note: 'nothing to pin' };
      return ev.hasLock
        ? { verdict: MET, evidence: 'lockfile committed' }
        : { verdict: NOT_MET, evidence: 'dependencies declared with no committed lockfile' };
    }
  },
  {
    id: 'PRV-02', domain: 'provenance', core: false, tell: 'INERT',
    criterion: 'The repository is under version control with history present.',
    why: 'Commit history is the only record of who decided what and when. A repository initialised in one commit has erased its own provenance.',
    assess: ev => existsSync(join(ev.root, '.git'))
      ? { verdict: MET, evidence: '.git present' }
      : { verdict: NOT_MET, evidence: 'no .git directory — history unavailable', note: 'N/A if assessing an exported archive; assessor must justify' }
  }
];

// ---------------------------------------------------------------------------
// SPEC FINGERPRINT  ·  a content hash of the criteria definitions. If this
// changes, the criteria changed, and SPEC_VERSION must be bumped + re-locked.
// This is what makes REV-03 mechanical instead of a matter of discipline.
// ---------------------------------------------------------------------------
function criteriaFingerprint() {
  const shape = CRITERIA
    .map(c => ({ id: c.id, domain: c.domain, core: c.core, tell: c.tell, criterion: c.criterion }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return createHash('sha256').update(JSON.stringify(shape)).digest('hex').slice(0, 32);
}

// ---------------------------------------------------------------------------
// ASSESS  ·  deterministic. content-addressed verdict.
// ---------------------------------------------------------------------------
function assess(root, threshold = DEFAULT_THRESHOLD) {
  const ev = gather(root);
  const results = CRITERIA.map(c => {
    const r = c.assess(ev);
    return { id: c.id, domain: c.domain, core: c.core, tell: c.tell, criterion: c.criterion, ...r };
  });

  const applicable = results.filter(r => r.verdict !== NA);
  const core       = results.filter(r => r.core && r.verdict !== NA);
  const nonCore    = results.filter(r => !r.core && r.verdict !== NA);

  const coreAllMet   = core.every(r => r.verdict === MET);
  const nonCoreMet   = nonCore.filter(r => r.verdict === MET).length;
  const nonCoreRatio = nonCore.length ? nonCoreMet / nonCore.length : 1;
  const badge        = coreAllMet && nonCoreRatio >= threshold;

  // the tell histogram: which behavioural signature dominates the failures
  const tally = {};
  for (const r of results) if (r.verdict === NOT_MET) tally[r.tell] = (tally[r.tell] || 0) + 1;
  const ranked = Object.entries(tally).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const dominant = ranked.length ? ranked[0][0] : null;

  const verdict = {
    spec: SPEC_VERSION,
    specFingerprint: criteriaFingerprint(),
    threshold,
    subject: basename(root),
    scanned: { files: ev.files.length, code: ev.code.length, tests: ev.tests.length, lines: ev.totalLines },
    results: results.map(({ id, verdict, evidence, note }) => ({ id, verdict, evidence, ...(note ? { note } : {}) })),
    summary: {
      core: `${core.filter(r => r.verdict === MET).length}/${core.length}`,
      nonCore: `${nonCoreMet}/${nonCore.length}`,
      nonCoreRatio: Number(nonCoreRatio.toFixed(4)),
      notApplicable: results.length - applicable.length
    },
    dominantTell: dominant,
    tellTally: Object.fromEntries(ranked),
    badge
  };

  // content-address the verdict. same input -> same hash -> citable, comparable.
  verdict.hash = createHash('sha256').update(JSON.stringify(verdict)).digest('hex').slice(0, 32);
  return { verdict, results, ev };
}

// ---------------------------------------------------------------------------
// REPORT
// ---------------------------------------------------------------------------
const C = { d: '\x1b[2m', b: '\x1b[1m', g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', c: '\x1b[36m', x: '\x1b[0m' };
const mark = v => v === MET ? `${C.g}  MET${C.x}` : v === NOT_MET ? `${C.r}✗ FAIL${C.x}` : `${C.d}  n/a${C.x}`;

function report(root, threshold) {
  const { verdict, results } = assess(root, threshold);

  console.log(`\n${C.b}THE ASSESSOR${C.x} ${C.d}· ${SPEC_VERSION} · deterministic · binary + N/A · threshold ${threshold}${C.x}`);
  console.log(`${C.d}${'─'.repeat(78)}${C.x}`);
  console.log(`subject  ${C.b}${verdict.subject}${C.x}`);
  console.log(`scanned  ${verdict.scanned.files} files · ${verdict.scanned.code} code · ${verdict.scanned.tests} test · ${verdict.scanned.lines} lines\n`);

  let domain = '';
  for (const r of results) {
    if (r.domain !== domain) { domain = r.domain; console.log(`${C.c}${domain.toUpperCase()}${C.x}`); }
    const core = r.core ? `${C.y}core${C.x}` : `${C.d}    ${C.x}`;
    console.log(`  ${mark(r.verdict)}  ${C.b}${r.id}${C.x} ${core}  ${r.criterion}`);
    console.log(`          ${C.d}${r.evidence}${C.x}`);
    if (r.note) console.log(`          ${C.d}n/a justification: ${r.note}${C.x}`);
    if (r.sample) for (const s of r.sample.slice(0, 3))
      console.log(`          ${C.d}→ ${s.file ? `${s.file}:${s.line} ${s.text || ''}` : `${s.count}× ${s.at[0].file}:${s.at[0].line}`}${C.x}`);
  }

  console.log(`\n${C.d}${'─'.repeat(78)}${C.x}`);
  console.log(`core criteria     ${verdict.summary.core}${verdict.summary.core.split('/')[0] === verdict.summary.core.split('/')[1] ? ` ${C.g}all met${C.x}` : ` ${C.r}not all met${C.x}`}`);
  console.log(`non-core          ${verdict.summary.nonCore}  (${(verdict.summary.nonCoreRatio * 100).toFixed(0)}% · threshold ${(threshold * 100).toFixed(0)}%)`);
  console.log(`not applicable    ${verdict.summary.notApplicable}`);
  if (verdict.dominantTell)
    console.log(`\ndominant tell     ${C.y}${verdict.dominantTell}${C.x} ${C.d}— ${TELLS[verdict.dominantTell]}${C.x}`);
  console.log(`\n${C.b}VERDICT${C.x}           ${verdict.badge ? `${C.g}PASS${C.x}` : `${C.r}FAIL${C.x}`}`);
  console.log(`${C.d}verdict hash      ${verdict.hash}${C.x}`);
  console.log(`${C.d}spec fingerprint  ${verdict.specFingerprint}${C.x}`);
  console.log(`${C.d}same input → same hash. two assessors converge by construction.${C.x}\n`);

  return verdict;
}

// ---------------------------------------------------------------------------
function main() {
  const args = process.argv.slice(2);
  const path = args.find(a => !a.startsWith('--')) || '.';
  const tArg = args.find(a => a.startsWith('--threshold='));
  const threshold = tArg ? Number(tArg.split('=')[1]) : DEFAULT_THRESHOLD;

  if (args.includes('--fingerprint')) {
    console.log(criteriaFingerprint());
  } else if (!existsSync(path)) {
    console.error(`no such path: ${path}`); process.exit(2);
  } else if (args.includes('--json')) {
    const { verdict } = assess(path, threshold);
    console.log(JSON.stringify(verdict, null, 2));
  } else {
    const v = report(path, threshold);
    process.exit(v.badge ? 0 : 1);
  }
}

// run only as a CLI, not when imported by tests or the spec-version check
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();

export { assess, gather, CRITERIA, TELLS, SPEC_VERSION, criteriaFingerprint };
