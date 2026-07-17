# Changelog

The changelog says *why*, not just what. When a criterion changes because it met a real codebase and
lost, the entry names the failure that caused it.

## assessor-v0.5

Third expansion batch (20 → 24 criteria), the no-git remainder — all deterministic against the walk.

- **SPEC-04** — every architecture decision record declares a concrete, non-placeholder Status.
- **SPEC-05** — every run command in a README's code blocks is a defined script or make target.
- **BND-03** (core) — every file path the manifest wires up (entrypoints, script targets) resolves to a
  file, unless it is a declared build output. *Agents point `main`/`bin` at a file they never generated.*
- **EVO-02** — no source comment leads with a defect marker (FIXME/HACK/XXX/BUG/BROKEN/WIP). Distinct
  from SPEC-02's TODO-family density; the marker set is built from an array so the detector can't flag
  its own definition.

**REV-06 — SPEC-05 read prose and doc-examples as commands (found by self-assessment).** Its first run
flagged English prose ("make **the** …") and the plan doc's own example commands (`npm run build`) as
undefined. Run commands are now extracted only from **code regions of README-family docs** — not prose,
not design docs that merely describe commands. The fourth self-found fix (REV-03/04/05/06).

Self-assessment stays PASS: 9/9 core, 13/13 non-core (100%). `SPEC_VERSION` → v0.5, re-locked.

## assessor-v0.4

Second expansion batch (17 → 20 criteria), still zero-git and deterministic against the static walk.

- **VER-06** (core) — the CI configuration contains a step that invokes a test runner, not just a lint
  or build. *A green check that never ran the tests certifies nothing.*
- **VER-07** (core) — assertion calls number at least as many as test-case declarations. *Agents write
  cases that call the code but assert nothing — the case runs, passes, and verifies nothing.* (`require`
  is excluded from the assertion set.)
- **EVO-03** — no normalised eight-line source block appears twice. *Catches whole regenerated functions
  that the two-line EVO-01 measures differently.* Comment-only lines and blanks are dropped first.

Self-assessment stays PASS: 8/8 core, 11/11 non-core (100%). `SPEC_VERSION` → v0.4, re-locked.

## assessor-v0.3

First batch of the rubric expansion (13 → 17 criteria), the zero-risk, no-git group. Each is
deterministic against a static walk; the corpus and self-assessment stayed green throughout.

- **SPEC-03** (non-core) — every relative documentation link/image target resolves to a path in the
  repository. *Agents link to modules and guides they never created, or that were renamed.* Targets
  resolve against the exact-case walked path set, never `existsSync` (a case-insensitive filesystem
  would otherwise make the verdict OS-dependent).
- **VER-05** (core) — the test suite imports at least one module from the project's own source tree.
  *A suite that imports only the framework is green and proves nothing.*
- **ACC-03** (core) — the README carries no token from a frozen scaffold-placeholder list.
- **ACC-04** (non-core) — manifest `author`/`description`, if present, are not known scaffold
  placeholders. Placeholder lists are frozen and closed — an open list lets two assessors diverge.

**REV-05 — the link checker flagged its own example (found by self-assessment).** SPEC-03's first run
against this repo failed on a `[text](target)` written *as an example inside a code span* in the v0.3
plan doc. A link inside a code fence or `` `span` `` is an example, not a link; the checker now strips
code before extracting links (standard link-checker behaviour). Same pattern as REV-04 — a finding the
tool made against itself, fixed in the open.

Remaining v0.3 criteria (BND-03/04/05, EVO-02/03, SPEC-04/05, VER-06/07) and the git-history domain
(PRV-03/04/05, ACC-05) are designed in `docs/RUBRIC-v0.3-plan.md` and land in later batches — the git
ones behind their determinism rules.

## assessor-v0.2

The version that submits to its own rubric. `v0.1` failed its own standard (1 of 3 core criteria);
this release fixes those failures in public before the assessor is pointed at anyone else.

**Made it pass its own rubric (P0).** Added the things whose absence it flags in others: a spec
(`SPEC.md`), tests (`tests/`), CI (`.github/workflows/ci.yml`), a README, a licence, and committed
agent instructions (`CLAUDE.md`). `npm run self` now returns PASS; CI fails if that ever regresses.

**SPEC_VERSION is now enforced (REV-03).** In `v0.1`, patching two criteria silently changed the
verdict hash while the version string stayed put — a verdict that can't be reproduced against a
stated version is worthless. `criteriaFingerprint()` now hashes the criteria definitions,
`spec-lock.json` pins that fingerprint to the version, and `scripts/check-spec-version.mjs` (in CI)
fails on any silent drift. The fingerprint is also stamped into every verdict.

**Carried forward from `v0.1`, found by running it against a repo built to fail:**
- *REV-01* — the 100-line floor was hiding the two highest-signal detectors (marker density and
  duplication) on small repos. Floor lowered to 30 lines.
- *REV-02* — duplication detection hashed a 6-line window, but normalisation collapses a regenerated
  function body to ~2 qualifying lines, so a 6-line window could never match the exact thing it
  exists to catch. Window lowered to 2 lines.

**REV-04 — the marker detector flagged its own definition (found by self-assessment).** Running the
assessor on itself, SPEC-02 reported three abandoned-subgoal markers in `assessor.mjs` — but they were
the literal strings `(TODO/FIXME/XXX/HACK)` that *define* the detector, not real abandoned work. A
marker now counts only in tag context (`TODO:`, `TODO(`, `TODO!`, `TODO` before whitespace/end), not
when the words merely appear inside a `/`- or `|`-delimited list. The badge already passed (SPEC-02 is
non-core), but a false positive in the highest-noise detector is worth removing. The proper fix is
comment-aware parsing (a later revision); this is the cheap, correct tightening. This is the method: a
finding the tool made against itself, fixed in the open.

**Portability fix.** Paths are now normalised to forward slashes, so criteria that match on `/`
(test-file detection, CI detection) work on Windows as well as POSIX. A verdict must not depend on
the operating system it was produced on.

**`.assessorignore`.** A gitignore-style prefix list, read from the repository root, for fixtures the
assessor should not treat as product code. This repository uses it to exclude `test-corpus/` — the
deliberately-broken demo repos it ships as its regression suite — from its own self-assessment.

## assessor-v0.1

Initial prototype. Deterministic single-pass assessment, binary + N/A + threshold scoring,
content-addressed verdict, thirteen criteria across six domains, seven behavioural tells. Shipped
while still embarrassing — on purpose. It failed its own rubric, and that failure is what `v0.2`
addresses first.
