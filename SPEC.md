# The Assessor — Rubric Specification

`assessor-v0.2` · binary · deterministic · threshold-gated

This document is the rubric. The program in `assessor.mjs` is its executable form. Where prose and
code disagree, that is a bug in one of them — file it.

## 1 · Why this exists

> Two independent assessors examining the same repository should reach substantially the same
> verdict. If two practitioners can look at the same codebase and disagree about whether it passes,
> we don't have a rubric — we have opinions with a logo on them.

Two humans diverge. A deterministic program cannot. **Same repository → same verdict → same hash.**
Inter-assessor agreement is 1.00 by construction, not by training. Everything below serves that.

## 2 · Scoring model

**Binary, with an explicit `N/A`, and a published threshold. No grading, ever.**

- Each criterion returns `MET`, `NOT_MET`, or `N/A`. The moment "partially meets" exists, two
  assessors diverge and reproducibility is gone.
- `N/A` must carry a written justification (`note`) stating why the criterion does not apply.
- **Core** criteria must *all* be `MET` (excluding those that are `N/A`).
- A published **threshold** (default `0.70`) of the *non-core* applicable criteria must be `MET`.
- The **badge** is `PASS` iff both hold.

`N/A` criteria are excluded from both counts — they neither help nor harm the badge.

## 3 · Determinism guarantees

Violate any of these and the thesis dies:

- **Sorted file walk.** Directory order is never trusted (`readdirSync(...).sort()`).
- **No clock, no randomness, no network, no locale, no environment** enters the verdict.
- **Evidence is gathered once**, in a single pass; criteria read from that evidence and never
  re-walk the tree.
- **Paths are normalised to forward slashes**, so a verdict does not depend on the operating system.
- The **whole verdict object is hashed** (`sha256`, first 32 hex chars), so any drift is visible.

Fixtures the assessor should not treat as product code (test corpora, vendored copies) are listed in
`.assessorignore`, a gitignore-style prefix list read from the repository root.

## 4 · The six domains

| domain | prefix | asks |
|---|---|---|
| specification integrity | `SPEC-` | is there a durable record of what the code was meant to do? |
| verification integrity | `VER-` | is the code actually exercised, and is that exercise honest? |
| agent boundaries | `BND-` | is the agent constrained, committed, and reviewable? |
| human accountability | `ACC-` | did a human own this? |
| evolvability | `EVO-` | can the next change be made safely? |
| provenance | `PRV-` | is this the artefact that was reviewed, and can you trace how it got here? |

**Criterion IDs are stable, permanent, and never reused.** `SPEC-03` retired is `SPEC-03` retired
forever; the next new one is the next unused number. Assessors and clients cite them for years.

## 5 · The seven tells

Behavioural signatures of agent-generated code. Each criterion is tagged with the tell it detects;
the verdict reports the **dominant tell** — the failure mode that dominates the `NOT_MET` results.

| tell | signature |
|---|---|
| `UNSPENT` | declared and never used (deps, imports, exports) |
| `UNOPENED` | code paths with no test that exercises them |
| `REPEAT` | near-identical blocks regenerated rather than factored |
| `PASSED` | tests skipped, pending, or always-true |
| `COLLAPSED` | abandoned subgoals left in place (TODO/FIXME/XXX) |
| `ECHOED` | scaffold/boilerplate retained unmodified |
| `INERT` | unreachable or no-op code |

## 6 · The criteria (v0.2)

Thirteen criteria. `core` criteria are marked ●. Each carries the failure it was written from.

### specification integrity
- **SPEC-01** ● (`COLLAPSED`) — A written specification, design note, or ADR exists and is
  version-controlled alongside the code. *Agents generate from a prompt that is then discarded;
  without a durable spec, no one can say what the code was supposed to do.*
- **SPEC-02** (`COLLAPSED`) — Abandoned subgoal markers (TODO/FIXME/XXX/HACK) number fewer than 1
  per 200 lines of code. *Marker density is the most direct measure of intent started and dropped.*
  N/A under 30 lines.

### verification integrity
- **VER-01** ● (`UNOPENED`) — The repository contains tests. *Generated code arrives confident and
  unexercised; the absence of tests is an unassessable codebase, not a maturity level.*
- **VER-02** ● (`PASSED`) — No test is skipped, pending, or disabled without an adjacent written
  justification. *A skipped test is a failing test with the alarm removed.* N/A when no tests exist.
- **VER-03** (`UNOPENED`) — Test files number at least 1 per 4 source files. *Catches the case where
  tests were written for the demo path and nothing else.* N/A with no source files.
- **VER-04** (`UNOPENED`) — An automated check runs on every change (CI configuration present).
  *Without CI, "the tests pass" means one person ran them once on one machine.*

### agent boundaries
- **BND-01** (`ECHOED`) — Agent instructions/configuration are committed to the repository. *If the
  agent is steered by a file on one machine, the build is not reproducible and the constraints are
  not reviewable.* N/A if no agents are used — the assessor must justify.
- **BND-02** (`UNSPENT`) — Every declared runtime dependency is imported somewhere in the source.
  *Each unused dependency is unreviewed third-party code inside the trust boundary for no benefit.*
  N/A when no dependency manifest is read.

### human accountability
- **ACC-01** ● (`ECHOED`) — A README states what the system is for and how to run it. *The cheapest
  test of whether a human ever owned this.*
- **ACC-02** (`ECHOED`) — A licence file is present. *Legal accountability is the floor of human
  accountability.*

### evolvability
- **EVO-01** (`REPEAT`) — No two-line normalised code block is repeated more than twice across the
  codebase. *An agent asked for a similar feature regenerates rather than factors; each copy then
  diverges, and a fix applied to one is not applied to the others.* N/A under 30 lines.

### provenance
- **PRV-01** ● (`UNSPENT`) — Dependency versions are pinned by a committed lockfile. *Without a lock,
  the code that was assessed is not the code that will run.* N/A with no manifest or zero
  dependencies.
- **PRV-02** (`INERT`) — The repository is under version control with history present. *A repository
  initialised in one commit has erased its own provenance.* N/A when assessing an exported archive —
  the assessor must justify.

## 7 · Versioning and reproducibility

A verdict is only meaningful relative to the spec version it was issued under.

- `SPEC_VERSION` is stamped into every verdict.
- `criteriaFingerprint()` is a content hash of the criteria definitions. `spec-lock.json` pins that
  fingerprint to the current version.
- Any criterion change must bump `SPEC_VERSION` and re-lock. `scripts/check-spec-version.mjs`
  enforces this and runs in CI — a silent criteria change fails the build before it reaches a client.
- Old spec versions remain runnable, so any issued verdict stays reproducible against its own version.

## 8 · Boundaries (liability, not preference)

- **Not a security standard.** Not a pen test, vulnerability scan, or compliance certification. This
  assesses how code is built with agents — the practice, the workflow, the specification surface.
- **No vendor names in criteria, ever.** "Mutation coverage is measured and acted upon" is a
  criterion; "uses tool X" is not. Vendor names compromise independence and date the document.
- **No maturity levels.** Binary only.
- **No unassessable criteria.** The test: *could a competent assessor be wrong about whether this is
  met?* If not, it is not a criterion. Every "the team should value…" is cut.

## 9 · The regression corpus

`test-corpus/clean-demo` must PASS; `test-corpus/slop-demo` must FAIL (exit 1); this repository must
PASS. Any criterion change is run against all three. If `clean-demo` ever fails, a criterion
over-fires. If `slop-demo` ever passes, a criterion is toothless.

## 10 · Revision

Openly licensed and versioned in public. Every change is a PR with a rationale; the changelog says
*why*. When a criterion changes because it met a real codebase and lost, publish the revision **and**
the engagement that caused it (sanitised). A rubric that visibly changes on contact with reality is
more credible than one that arrived complete.
