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
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// SPEC VERSION  ·  changes to criteria MUST bump this. A verdict is only
// meaningful relative to a stated spec version. Enforced by spec-lock.json +
// scripts/check-spec-version.mjs (the REV-03 fix).
// ---------------------------------------------------------------------------
const SPEC_VERSION = 'assessor-v0.6';
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
const DOC_EXT   = new Set(['.md', '.markdown', '.mdx', '.rst', '.adoc', '.txt']);

// resolve a doc-relative link target to a normalised repo path (forward slashes, '..'/'.' collapsed)
function resolveRel(dir, target) {
  const stack = [];
  for (const p of (dir ? dir.split('/') : []).concat(target.split('/'))) {
    if (p === '' || p === '.') continue;
    if (p === '..') stack.pop(); else stack.push(p);
  }
  return stack.join('/');
}

// EVO-02 defect markers — built into the regex from an array, so THIS file contains no literal
// comment-delimiter-plus-marker sequence that would flag itself (the REV-04/REV-05 lesson).
const DEFECT_MARKERS = ['FIXME', 'HACK', 'XXX', 'BUG', 'BROKEN', 'WIP'];
const DEFECT_RE = new RegExp('(?:^|\\s)(?:\\/\\/|#|--|\\/\\*|\\*)\\s*(' + DEFECT_MARKERS.join('|') + ')\\b');
const ADR_UNFILLED = new Set(['', 'todo', 'tbd', 'tba', '<status>', '[status]', 'n/a', 'xxx', '...']);

// Frozen git-provenance lists (PRV-05, ACC-05). ASCII case-folded, closed.
const THROWAWAY_SUBJECT = /^(wip|updates?|fix(es|ed)?|changes?|commit|misc|stuff|temp|tmp|minor|tweaks?|\.+)$/i;
const PLACEHOLDER_NAMES = new Set(['your name', 'name', 'user', 'unknown', 'root', 'admin']);
const PLACEHOLDER_EMAILS = new Set(['you@example.com', 'user@example.com', 'root@localhost', 'admin@localhost', 'you@example.org', 'me@example.com']);

// Read git history DETERMINISTICALLY: reachable-from-HEAD only, and only COUNTS/SUBJECTS/AUTHOR strings
// used for matching — never a commit hash, timestamp, or raw identity enters the verdict. N/A if no git.
function gitData(root) {
  const git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 24 });
  try {
    git(['rev-parse', '--git-dir']);                                 // throws if not a work tree
    const commitCount = parseInt(git(['rev-list', '--count', 'HEAD']).trim(), 10);
    const subjects = git(['log', '--format=%s', 'HEAD']).split('\n').filter(Boolean);
    const authors = git(['log', '--format=%an%x00%ae', 'HEAD']).split('\n').filter(Boolean)
      .map(l => { const [n, e] = l.split('\x00'); return { name: (n || '').trim().toLowerCase(), email: (e || '').trim().toLowerCase() }; });
    const fileCount = git(['ls-tree', '-r', '--name-only', 'HEAD']).split('\n').filter(Boolean).length;
    return { ok: true, commitCount, subjects, authors, fileCount };
  } catch { return { ok: false }; }
}

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
    deps: [], usedDeps: new Set(),
    pkgAuthor: null, pkgDescription: null, testImports: [],
    manifestRefs: [], buildOutputs: new Set(), defectMarkers: []
  };
  ev.git = gitData(root);   // reachable-from-HEAD counts/subjects/authors only (PRV-03/05, ACC-05)

  // exact-case path set (files + ancestor dirs) — link/entrypoint resolution compares against THIS,
  // never fs.existsSync, so a case-insensitive filesystem cannot make the verdict OS-dependent.
  ev.pathSet = new Set();
  for (const f of files) {
    ev.pathSet.add(f.rel);
    const parts = f.rel.split('/');
    for (let i = 1; i < parts.length; i++) ev.pathSet.add(parts.slice(0, i).join('/'));
  }

  // documentation files + their inline markdown link/image targets (reference-style links ignored)
  ev.docFiles = files.filter(f => DOC_EXT.has(f.ext) || /^readme/i.test(f.name));
  ev.docLinks = [];
  for (const f of ev.docFiles) {
    // strip code first — a [text](target) inside a code fence or `span` is an EXAMPLE, not a link
    const text = read(f)
      .replace(/```[\s\S]*?```/g, '').replace(/~~~[\s\S]*?~~~/g, '')
      .replace(/`[^`]*`/g, '');
    const re = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
    let m;
    while ((m = re.exec(text))) ev.docLinks.push({ file: f.rel, target: m[1].replace(/^<|>$/g, '') });
  }
  const readmeFile = files.find(f => /^readme/i.test(f.name));
  ev.readmeText = readmeFile ? read(readmeFile).toLowerCase() : null;

  // CI command text (VER-06) — concat of CI config contents, sorted-file order = deterministic
  ev.ciText = files
    .filter(f => /\.github\/workflows\/.*\.ya?ml$/i.test(f.rel) || /\.circleci\/config\.yml$/i.test(f.rel) || /^(\.gitlab-ci\.yml|azure-pipelines\.yml|Jenkinsfile|\.travis\.yml)$/i.test(f.name))
    .map(read).join('\n');

  // assertion + test-case counts (VER-07) — `require` deliberately excluded from the assertion set
  ev.testCases = 0; ev.assertions = 0;
  for (const f of tests) {
    const t = read(f);
    ev.testCases  += (t.match(/\b(it|test|specify)\s*\(|^\s*def\s+test_|@Test\b|func\s+Test[A-Z]/gm) || []).length;
    ev.assertions += (t.match(/\b(expect|assert\w*)\s*[(.]|\.should\b|\bt\.(Error|Fatal|Errorf|Fatalf)\b/g) || []).length;
  }

  // decision records + their Status (SPEC-04)
  ev.adrFiles = files.filter(f => /(^|\/)(adr|decisions)(\/|$)/i.test(f.rel) || /^(adr[-_])?\d{3,4}[-_].*\.(md|markdown)$/i.test(f.name));
  ev.adrBad = [];
  for (const f of ev.adrFiles) {
    const t = read(f);
    let status = (t.match(/^\s*status\s*:\s*(.+)$/im) || [])[1];
    if (status == null) {
      const ls = t.split('\n'); const idx = ls.findIndex(l => /^#{1,6}\s+status\s*$/i.test(l.trim()));
      if (idx >= 0) status = ls.slice(idx + 1).map(l => l.trim()).find(Boolean) || '';
    }
    if (status == null || ADR_UNFILLED.has(status.trim().toLowerCase()))
      ev.adrBad.push({ file: f.rel, line: '', text: `status: ${status == null ? '(missing)' : status.trim() || '(blank)'}` });
  }

  // run commands the reader is told to run (SPEC-05) — ONLY from CODE regions of README-family docs,
  // never prose ("make a decision") and never design docs that describe commands as examples.
  ev.docRunCmds = [];
  for (const f of ev.docFiles.filter(f => /^(readme|install|usage|contributing)|getting.?started/i.test(f.name))) {
    const code = [...read(f).matchAll(/```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`]+`/g)].map(m => m[0]).join('\n');
    for (const m of code.matchAll(/(?:npm|yarn|pnpm)\s+run\s+([A-Za-z0-9:_-]+)/g)) ev.docRunCmds.push({ file: f.rel, kind: 'script', name: m[1] });
    for (const m of code.matchAll(/(?:^|[\s`$])make\s+([A-Za-z0-9:_-]+)/gm)) ev.docRunCmds.push({ file: f.rel, kind: 'make', name: m[1] });
  }
  ev.makeTargets = new Set();
  const mkFile = files.find(f => /^(makefile|gnumakefile)$/i.test(f.name));
  if (mkFile) for (const m of read(mkFile).matchAll(/^([A-Za-z0-9][A-Za-z0-9:_-]*)\s*:/gm)) if (m[1].toLowerCase() !== '.phony') ev.makeTargets.add(m[1]);

  // package.json declared deps + ownership fields
  const pkgFile = files.find(f => f.name === 'package.json');
  if (pkgFile) {
    try {
      const pkg = JSON.parse(read(pkgFile));
      ev.deps = Object.keys(pkg.dependencies || {}).sort();
      ev.pkgScripts = Object.keys(pkg.scripts || {}).sort();
      ev.pkgAuthor = typeof pkg.author === 'string' ? pkg.author : (pkg.author && pkg.author.name) || null;
      ev.pkgDescription = typeof pkg.description === 'string' ? pkg.description : null;
      // BND-03: file paths the manifest wires up (entrypoints + script targets) + declared build outputs
      const addRef = v => { if (typeof v === 'string') { const p = v.replace(/^\.\//, ''); if (/^[\w][\w./-]*\.\w+$/.test(p)) ev.manifestRefs.push(p); } };
      for (const k of ['main', 'module', 'types', 'browser']) addRef(pkg[k]);
      const leaves = o => { if (typeof o === 'string') addRef(o); else if (o && typeof o === 'object') Object.values(o).forEach(leaves); };
      leaves(pkg.bin); leaves(pkg.exports);
      for (const cmd of Object.values(pkg.scripts || {})) {
        const toks = String(cmd).split(/\s+/);
        toks.forEach((tok, i) => {
          const p = tok.replace(/^\.\//, '');
          if (/^[\w][\w./-]*\.(mjs|cjs|js|ts|tsx|jsx|json|py|go|rs)$/.test(p)) ev.manifestRefs.push(p);
          if (['>', '--outfile', '--out-dir', '--out', '-o', '--dist-dir'].includes(tok) && toks[i + 1]) ev.buildOutputs.add(toks[i + 1].replace(/^\.\//, ''));
        });
      }
    } catch { /* malformed package.json is itself a finding, handled by SPEC-01 */ }
  }

  // single pass over code
  const blockHashes = new Map();
  const bigHashes = new Map();
  for (const f of code) {
    const text = read(f);
    const lines = text.split('\n');
    ev.totalLines += lines.length;

    // test-file import/require specifiers — for VER-05 (does the suite import its own source?)
    if (tests.includes(f)) {
      const importRe = /(?:\bfrom|\brequire\s*\(|^\s*import)\s*['"]([^'"]+)['"]/gm;
      let im;
      while ((im = importRe.exec(text))) ev.testImports.push({ file: f.rel, spec: im[1] });
    }

    lines.forEach((line, i) => {
      // a marker counts only in TAG context (TODO:, TODO(, TODO!, TODO<space/eol>) — NOT when the
      // words merely appear inside a '/'- or '|'-delimited list, e.g. the detector's own definition.
      if (/(^|[^A-Za-z0-9_])(TODO|FIXME|XXX|HACK)(:|\(|!|\s|$)/.test(line))
        ev.todos.push({ file: f.rel, line: i + 1, text: line.trim().slice(0, 100) });
      if (/\b(it|test|describe)\.(skip|todo)\b|\bxit\b|\bxdescribe\b|@pytest\.mark\.skip|t\.Skip\(/.test(line))
        ev.skips.push({ file: f.rel, line: i + 1, text: line.trim().slice(0, 100) });
      if (!tests.includes(f) && DEFECT_RE.test(line))    // EVO-02: defect marker leading a source comment
        ev.defectMarkers.push({ file: f.rel, line: i + 1, text: line.trim().slice(0, 80) });
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

    // EVO-03: normalised 8-line windows over SOURCE files only — larger regenerated blocks
    if (!tests.includes(f)) {
      const big = lines.filter(l => !/^\s*(\/\/|#|\*|--)/.test(l) && l.trim() !== '').map(l => l.replace(/\s+/g, ' ').trim());
      for (let i = 0; i + 8 <= big.length; i++) {
        const h = createHash('sha256').update(big.slice(i, i + 8).join('\n')).digest('hex').slice(0, 16);
        if (!bigHashes.has(h)) bigHashes.set(h, []);
        bigHashes.get(h).push({ file: f.rel, line: i + 1 });
      }
    }
  }
  ev.longDupes = [...bigHashes.entries()]
    .filter(([, hits]) => hits.length > 1)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, 20)
    .map(([, hits]) => ({ count: hits.length, at: hits.slice(0, 2) }));
  ev.dupes = [...blockHashes.entries()]
    .filter(([, hits]) => hits.length > 1)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, 50)
    .map(([h, hits]) => ({ hash: h, count: hits.length, at: hits.slice(0, 3) }));

  ev.unusedDeps = ev.deps.filter(d => !ev.usedDeps.has(d));
  return ev;
}

// Frozen scaffold-placeholder lists (ACC-03/04). Closed on purpose: an open "e.g." list lets two
// assessors scan for different tokens and diverge. Lowercase; matched as substrings / exact values.
const README_PLACEHOLDERS = [
  'lorem ipsum', 'description goes here', 'a short description of the project', 'your project name here',
  'todo: describe', 'get started by editing', 'bootstrapped with create', 'you can learn more in the',
  'this is a starter template', 'welcome to your new project', 'replace this readme', 'project description goes here'
];
const META_PLACEHOLDERS = new Set([
  'your name', 'a short description of the project', 'a short description', 'todo', 'description',
  'my-awesome-project', 'package description', 'add description here', 'your name <you@example.com>'
]);

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
  {
    id: 'SPEC-03', domain: 'specification integrity', core: false, tell: 'COLLAPSED',
    criterion: 'Every relative link and image target in committed documentation resolves to a path in the repository.',
    why: 'Agents describe and link to modules, guides, or scripts they never created, or that were later renamed, so the durable record points at nothing.',
    assess: ev => {
      if (ev.docFiles.length === 0) return { verdict: NA, evidence: 'no documentation files', note: 'no docs to check links in' };
      const broken = [];
      for (const { file, target } of ev.docLinks) {
        if (/^(https?:|mailto:|tel:|#)/i.test(target) || target.includes('://') || target.startsWith('//')) continue;
        let t = target.split('#')[0].split('?')[0];
        if (!t) continue;                                  // pure in-page anchor
        try { t = decodeURIComponent(t); } catch { /* keep raw */ }
        if (!ev.pathSet.has(resolveRel(file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '', t)))
          broken.push({ file, line: '', text: `→ ${target}` });
      }
      return broken.length === 0
        ? { verdict: MET, evidence: `all ${ev.docLinks.length} documentation link(s) resolve` }
        : { verdict: NOT_MET, evidence: `${broken.length} documentation link(s) resolve to nothing`, sample: broken.slice(0, 5) };
    }
  },
  {
    id: 'SPEC-04', domain: 'specification integrity', core: false, tell: 'COLLAPSED',
    criterion: 'Every architecture decision record declares a concrete, non-placeholder Status.',
    why: 'Agents generate decision records from a template and leave the Status blank, so a reader cannot tell whether a documented decision is proposed, accepted, or superseded.',
    assess: ev => {
      if (ev.adrFiles.length === 0) return { verdict: NA, evidence: 'no decision records found', note: 'no ADRs to check' };
      return ev.adrBad.length === 0
        ? { verdict: MET, evidence: `all ${ev.adrFiles.length} decision record(s) declare a Status` }
        : { verdict: NOT_MET, evidence: `${ev.adrBad.length} decision record(s) with a missing or placeholder Status`, sample: ev.adrBad.slice(0, 3) };
    }
  },
  {
    id: 'SPEC-05', domain: 'specification integrity', core: false, tell: 'COLLAPSED',
    criterion: "Every run command referenced in documentation is defined in the project's script/target manifest.",
    why: 'Agents document build and run commands that were never wired up, so following the README fails.',
    assess: ev => {
      if (!ev.docRunCmds || ev.docRunCmds.length === 0) return { verdict: NA, evidence: 'no run commands referenced in docs', note: 'nothing to check' };
      const scripts = new Set(ev.pkgScripts || []);
      const missing = ev.docRunCmds.filter(c => c.kind === 'make' ? !ev.makeTargets.has(c.name) : !scripts.has(c.name));
      return missing.length === 0
        ? { verdict: MET, evidence: `all ${ev.docRunCmds.length} documented run command(s) are defined` }
        : { verdict: NOT_MET, evidence: `${missing.length} documented run command(s) not defined in the manifest`, sample: missing.slice(0, 3).map(c => ({ file: c.file, line: '', text: `${c.kind === 'make' ? 'make' : 'run'} ${c.name}` })) };
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
  {
    id: 'VER-05', domain: 'verification integrity', core: true, tell: 'UNOPENED',
    criterion: "The test suite imports at least one module from the project's own source tree.",
    why: 'A suite that imports only the test framework or third-party modules exercises none of the project\'s own code — it is green and proves nothing.',
    assess: ev => {
      if (ev.tests.length === 0) return { verdict: NA, evidence: 'no tests present', note: 'VER-01 covers test presence' };
      const isSource = s => /^\.\.?\//.test(s)
        && !/(^|\/)(tests?|__tests__|__mocks__|spec)(\/|$)/i.test(s)
        && !/\.(test|spec)\.[a-z]+$/i.test(s);
      return ev.testImports.some(t => isSource(t.spec))
        ? { verdict: MET, evidence: 'tests import project source modules' }
        : { verdict: NOT_MET, evidence: 'no test imports a relative project source module (tests may exercise only the framework)' };
    }
  },
  {
    id: 'VER-06', domain: 'verification integrity', core: true, tell: 'PASSED',
    criterion: 'The continuous-integration configuration contains a step that invokes a test runner.',
    why: 'Agents add CI that lints or builds but never runs the tests, so a green check certifies nothing was verified.',
    assess: ev => {
      if (!ev.hasCI) return { verdict: NA, evidence: 'no CI configuration', note: 'VER-04 covers CI presence; nothing to inspect' };
      return /\b(npm|yarn|pnpm)\s+(run\s+)?test\b|\bnode\s+--test\b|\bgo\s+test\b|\bcargo\s+test\b|\bpytest\b|python\s+-m\s+pytest\b|\brspec\b|\b(mvn|gradle)\b[^\n]*\btest\b/i.test(ev.ciText || '')
        ? { verdict: MET, evidence: 'CI invokes a test runner' }
        : { verdict: NOT_MET, evidence: 'CI configuration runs no recognised test command' };
    }
  },
  {
    id: 'VER-07', domain: 'verification integrity', core: true, tell: 'PASSED',
    criterion: 'Across the test suite, assertion calls number at least as many as test-case declarations.',
    why: 'Agents write test cases that call the code but assert nothing, so the case runs, passes, and verifies nothing.',
    assess: ev => {
      if (ev.tests.length === 0) return { verdict: NA, evidence: 'no tests present', note: 'VER-01 covers test presence' };
      if (ev.testCases === 0) return { verdict: NA, evidence: 'no recognised test-case declarations', note: 'test style not recognised by this version' };
      return ev.assertions >= ev.testCases
        ? { verdict: MET, evidence: `${ev.assertions} assertion(s) across ${ev.testCases} test case(s)` }
        : { verdict: NOT_MET, evidence: `${ev.assertions} assertion(s) for ${ev.testCases} test case(s) — under 1 per case` };
    }
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
  {
    id: 'BND-03', domain: 'agent boundaries', core: true, tell: 'INERT',
    criterion: 'Every file path the package manifest wires up (entrypoints and script targets) resolves to a file, unless it is a declared build output.',
    why: 'Agents point main/bin or a script at a file they never generated, so the wired-up entrypoint is dead on arrival.',
    assess: ev => {
      if (!ev.hasPkg) return { verdict: NA, evidence: 'no package.json', note: 'no manifest to resolve' };
      const refs = [...new Set(ev.manifestRefs)];
      if (refs.length === 0) return { verdict: MET, evidence: 'no manifest file references to resolve' };
      const unresolved = refs.filter(p => !ev.pathSet.has(p) && !ev.buildOutputs.has(p) && !/^(dist|build|out|lib)\//.test(p));
      return unresolved.length === 0
        ? { verdict: MET, evidence: `all ${refs.length} manifest path(s) resolve` }
        : { verdict: NOT_MET, evidence: `${unresolved.length} manifest path(s) resolve to nothing: ${unresolved.slice(0, 4).join(', ')}` };
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
  {
    id: 'ACC-03', domain: 'human accountability', core: true, tell: 'ECHOED',
    criterion: 'The README contains no unmodified template or scaffold placeholder text.',
    why: 'Agents hand back the generator\'s default README, so the record looks complete but says nothing about what this particular code is for.',
    assess: ev => {
      if (ev.readmeText == null) return { verdict: NA, evidence: 'no README', note: 'ACC-01 covers README presence' };
      const hits = README_PLACEHOLDERS.filter(p => ev.readmeText.includes(p));
      return hits.length === 0
        ? { verdict: MET, evidence: 'no scaffold placeholder text in README' }
        : { verdict: NOT_MET, evidence: `README carries scaffold placeholder(s): ${hits.slice(0, 3).join('; ')}` };
    }
  },
  {
    id: 'ACC-04', domain: 'human accountability', core: false, tell: 'ECHOED',
    criterion: 'Any author or description field in the package manifest is not a known scaffold placeholder value.',
    why: 'A manifest still carrying "Your Name" or "A short description of the project" is output nobody edited or reviewed.',
    assess: ev => {
      if (!ev.hasPkg) return { verdict: NA, evidence: 'no package.json', note: 'no manifest ownership fields to read' };
      const present = [ev.pkgAuthor, ev.pkgDescription].filter(Boolean).map(v => String(v).trim().toLowerCase());
      if (present.length === 0) return { verdict: NA, evidence: 'no author/description fields present', note: 'nothing to check' };
      const bad = present.filter(v => META_PLACEHOLDERS.has(v));
      return bad.length === 0
        ? { verdict: MET, evidence: `manifest ownership field(s) are specific (${present.length} checked)` }
        : { verdict: NOT_MET, evidence: `placeholder ownership value: ${bad.join('; ')}` };
    }
  },
  {
    id: 'ACC-05', domain: 'human accountability', core: false, tell: 'ECHOED',
    criterion: 'No commit author identity is a known unconfigured-git or scaffold placeholder.',
    why: 'A commit authored by "Your Name" or an unconfigured default means nobody put their name to the change.',
    assess: ev => {
      if (!ev.git.ok || ev.git.authors.length === 0) return { verdict: NA, evidence: 'no readable git history', note: 'PRV-02 covers .git presence; git unavailable or no commits' };
      const bad = ev.git.authors.filter(a => PLACEHOLDER_NAMES.has(a.name) || PLACEHOLDER_EMAILS.has(a.email) || /@(localhost|[\w.-]+\.local|[\w.-]*\(none\))$/.test(a.email)).length;
      return bad === 0
        ? { verdict: MET, evidence: `${ev.git.authors.length} commit author identity value(s), none placeholder` }
        : { verdict: NOT_MET, evidence: `${bad} commit(s) with a placeholder author identity` };
    }
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
  {
    id: 'EVO-03', domain: 'evolvability', core: false, tell: 'REPEAT',
    criterion: 'No normalised eight-line block of source code appears in two or more places.',
    why: 'An agent regenerates a whole function rather than factoring it; the copies then drift, and a fix applied to one is not applied to the others. This catches larger verbatim blocks than the two-line EVO-01.',
    assess: ev => {
      if (ev.totalLines < 30) return { verdict: NA, evidence: 'codebase under 30 lines', note: 'insufficient code to assess duplication' };
      return ev.longDupes.length === 0
        ? { verdict: MET, evidence: 'no eight-line source block repeated' }
        : { verdict: NOT_MET, evidence: `${ev.longDupes.length} eight-line block(s) duplicated (worst: ${ev.longDupes[0].count}x)`, sample: ev.longDupes.slice(0, 3) };
    }
  },
  {
    id: 'EVO-02', domain: 'evolvability', core: false, tell: 'COLLAPSED',
    criterion: 'No source comment carries a defect marker (FIXME, HACK, XXX, BUG, BROKEN, WIP) as its leading token.',
    why: 'A defect the author admitted in a comment and did not fix is a known hazard shipped in place; agents leave these behind routinely. Distinct from SPEC-02, which measures TODO-family density.',
    assess: ev => (ev.defectMarkers || []).length === 0
      ? { verdict: MET, evidence: 'no defect markers leading source comments' }
      : { verdict: NOT_MET, evidence: `${ev.defectMarkers.length} defect marker(s) in source comments`, sample: ev.defectMarkers.slice(0, 3) }
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
  },
  {
    id: 'PRV-03', domain: 'provenance', core: true, tell: 'ECHOED',
    criterion: 'A non-trivial repository has more than one commit in its history.',
    why: 'A repository with a single commit has no record of how it was built — the agent dumped its output and called it done.',
    assess: ev => {
      if (!ev.git.ok) return { verdict: NA, evidence: 'no readable git history', note: 'PRV-02 covers .git presence; git unavailable or no commits' };
      if (ev.git.fileCount <= 3) return { verdict: NA, evidence: `only ${ev.git.fileCount} tracked file(s)`, note: 'too small to expect a commit history' };
      return ev.git.commitCount >= 2
        ? { verdict: MET, evidence: `${ev.git.commitCount} commits reachable from HEAD` }
        : { verdict: NOT_MET, evidence: 'a single commit — no development history' };
    }
  },
  {
    id: 'PRV-05', domain: 'provenance', core: false, tell: 'COLLAPSED',
    criterion: 'Fewer than a quarter of commits carry an empty or throwaway message.',
    why: 'Bulk "wip"/"fix"/"update" subjects are the signature of commits generated to satisfy a hook rather than to record a decision.',
    assess: ev => {
      if (!ev.git.ok || ev.git.subjects.length === 0) return { verdict: NA, evidence: 'no readable git history', note: 'nothing to assess' };
      const n = ev.git.subjects.length;
      const bad = ev.git.subjects.filter(s => s.trim() === '' || THROWAWAY_SUBJECT.test(s.trim())).length;
      return bad / n < 0.25
        ? { verdict: MET, evidence: `${bad}/${n} commits have a throwaway message` }
        : { verdict: NOT_MET, evidence: `${bad}/${n} commits have an empty or throwaway message` };
    }
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
