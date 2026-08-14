# The Assessor — Rubric Specification

binary · deterministic · threshold-gated · the spec version is stamped on the criteria list below and
on every verdict, so this document never carries a version of its own to go stale

This document is the rubric, and **§6 is generated from `assessor.mjs`** — the criteria listed there
are the criteria the program applies, rendered, not a description of them maintained alongside.

⚑ It was not always. Until v0.8 this file described thirteen criteria while the program applied
twenty-seven, so fourteen rules — five of them core — could fail a repository without appearing in
the published rubric at all. Prose and code cannot be kept in step by intention; `scripts/sync-spec.mjs
--check` runs in CI and fails the build if they part.

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

## 6 · The criteria

<!-- BEGIN GENERATED CRITERIA · edit assessor.mjs, then run scripts/sync-spec.mjs -->

**27 criteria** · 11 core (marked ●) · spec `assessor-v0.9`.

This section is generated from the criteria the assessor actually applies. It is not a
description of the program — it is the program's own list, rendered. Each entry carries the
tell it detects and the failure it was written from.


### specification integrity
- **SPEC-01** ● (`COLLAPSED`) — A written specification, design note, or ADR exists and is version-controlled alongside the code. *Agents generate from a prompt that is discarded. Without a durable spec, no one can say what the code was supposed to do, so no one can say whether it is wrong.*
- **SPEC-02** (`COLLAPSED`) — Abandoned subgoal markers (TODO/FIXME/XXX/HACK) number fewer than 1 per 200 lines of code. *Agents open subgoals and do not close them. Marker density is the most direct measure of intent that was started and dropped.*
- **SPEC-03** (`COLLAPSED`) — Every relative link and image target in committed documentation resolves to a path in the repository. *Agents describe and link to modules, guides, or scripts they never created, or that were later renamed, so the durable record points at nothing.*
- **SPEC-04** (`COLLAPSED`) — Every architecture decision record declares a concrete, non-placeholder Status. *Agents generate decision records from a template and leave the Status blank, so a reader cannot tell whether a documented decision is proposed, accepted, or superseded.*
- **SPEC-05** (`COLLAPSED`) — Every run command referenced in documentation is defined in the project's script/target manifest. *Agents document build and run commands that were never wired up, so following the README fails.*

### verification integrity
- **VER-01** ● (`UNOPENED`) — The repository contains tests. *The single most common finding. Generated code arrives confident and unexercised. Absence of tests is not a maturity level, it is an unassessable codebase.*
- **VER-02** ● (`PASSED`) — No test is skipped, pending, or disabled without an adjacent written justification. *A skipped test is a failing test with the alarm removed. Agents skip a test to make the suite green and report success.*
- **VER-03** (`UNOPENED`) — Test files number at least 1 per 4 source files. *Not a coverage metric. A ratio this coarse only catches the case where tests were written for the demo path and nothing else.*
- **VER-04** (`UNOPENED`) — An automated check runs on every change (CI configuration present). *Without CI, "the tests pass" means one person ran them once on one machine. Agent-assisted teams ship faster than manual verification can follow.*
- **VER-05** ● (`UNOPENED`) — The test suite imports at least one module from the project's own source tree. *A suite that imports only the test framework or third-party modules exercises none of the project's own code — it is green and proves nothing.*
- **VER-06** ● (`PASSED`) — The continuous-integration configuration contains a step that invokes a test runner. *Agents add CI that lints or builds but never runs the tests, so a green check certifies nothing was verified.*
- **VER-07** ● (`PASSED`) — Across the test suite, assertion calls number at least as many as test-case declarations. *Agents write test cases that call the code but assert nothing, so the case runs, passes, and verifies nothing.*

### agent boundaries
- **BND-01** (`ECHOED`) — Agent instructions/configuration are committed to the repository. *If the agent is steered by a file on one developer's machine, the build is not reproducible and the agent's constraints are not reviewable.*
- **BND-02** (`UNSPENT`) — Every declared runtime dependency is imported somewhere in the source. *Agents add dependencies speculatively and abandon the approach. Each unused dependency is unreviewed third-party code inside the trust boundary for no benefit.*
- **BND-03** ● (`INERT`) — Every file path the package manifest wires up (entrypoints and script targets) resolves to a file, unless it is a declared build output. *Agents point main/bin or a script at a file they never generated, so the wired-up entrypoint is dead on arrival.*

### human accountability
- **ACC-01** ● (`ECHOED`) — A README states what the system is for and how to run it. *The cheapest possible test of whether a human ever owned this. Generated repositories routinely have none, or have one describing a template.*
- **ACC-02** (`ECHOED`) — A licence file is present. *Legal accountability is the floor of human accountability. Its absence usually means nobody made a decision about the code, they just accepted output.*
- **ACC-03** ● (`ECHOED`) — The README contains no unmodified template or scaffold placeholder text. *Agents hand back the generator's default README, so the record looks complete but says nothing about what this particular code is for.*
- **ACC-04** (`ECHOED`) — Any author or description field in the package manifest is not a known scaffold placeholder value. *A manifest still carrying "Your Name" or "A short description of the project" is output nobody edited or reviewed.*
- **ACC-05** (`ECHOED`) — No commit author identity is a known unconfigured-git or scaffold placeholder. *A commit authored by "Your Name" or an unconfigured default means nobody put their name to the change.*

### evolvability
- **EVO-01** (`REPEAT`) — No two-line normalised code block is repeated more than twice across the codebase. *The signature finding of agent-maintained code. An agent asked for a similar feature regenerates rather than factors. Each copy then diverges, and a fix applied to one is not applied to the others.*
- **EVO-03** (`REPEAT`) — No normalised eight-line block of source code appears in two or more places. *An agent regenerates a whole function rather than factoring it; the copies then drift, and a fix applied to one is not applied to the others. This catches larger verbatim blocks than the two-line EVO-01.*
- **EVO-02** (`COLLAPSED`) — No source comment carries a defect marker (FIXME, HACK, XXX, BUG, BROKEN, WIP) as its leading token. *A defect the author admitted in a comment and did not fix is a known hazard shipped in place; agents leave these behind routinely. Distinct from SPEC-02, which measures TODO-family density.*

### provenance
- **PRV-01** ● (`UNSPENT`) — Dependency versions are pinned by a committed lockfile. *Without a lock, the code that was assessed is not the code that will run. Provenance is the claim that this artefact is the one that was reviewed.*
- **PRV-02** (`INERT`) — The repository is under version control with history present. *Commit history is the only record of who decided what and when. A repository initialised in one commit has erased its own provenance.*
- **PRV-03** ● (`ECHOED`) — A non-trivial repository has more than one commit in its history. *A repository with a single commit has no record of how it was built — the agent dumped its output and called it done.*
- **PRV-05** (`COLLAPSED`) — Fewer than a quarter of commits carry an empty or throwaway message. *Bulk "wip"/"fix"/"update" subjects are the signature of commits generated to satisfy a hook rather than to record a decision.*

Tells: `UNSPENT` · `UNOPENED` · `REPEAT` · `PASSED` · `COLLAPSED` · `ECHOED` · `INERT`.

**N/A conditions are not listed here.** They are decided per repository and printed with a
written justification on every run, because whether a criterion applies is a fact about the
repository in front of you, not about the rubric.

<!-- END GENERATED CRITERIA -->

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
