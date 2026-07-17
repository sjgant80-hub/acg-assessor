# Rubric expansion plan — v0.3 (13 → 30 criteria)

Status: **27 of the planned ~30 shipped.** Landed: SPEC-03/04/05, VER-05/06/07, BND-03, ACC-03/04/05,
EVO-02/03, PRV-03/05 (through `v0.6`). **Deferred with reasons** (see CHANGELOG): PRV-04 (root-majority
over-fires on normally-bootstrapped repos — needs to also require no real subsequent history); BND-04
(stub bodies) and BND-05 (unused exports) need AST-backed body-delimitation / a reference index rather
than regex. This is the output of a criteria-authoring pass:
each domain was mined for "what has an agent done that a careful human wouldn't," then every candidate
was run against the six hard gates (binary · deterministic · no vendor · surface-safe · not security ·
from scar tissue). What survived is below. It ships incrementally — each landed batch bumps
`SPEC_VERSION` and re-locks; the regression corpus is re-run every time.

Seventeen new criteria bring six domains to ~5 each (VER runs richer — three orthogonal ways a suite
can be fake). Existing IDs are unchanged and never reused.

## specification integrity (→ 5)
- **SPEC-03** · non-core · `COLLAPSED` — Every relative link/image target in committed documentation
  resolves (exact case) to a path seen during the walk. *Agents link to modules and guides they never
  created, or that were renamed.* Assess: extract `[text](target)` from doc files; drop absolute/anchor
  targets; resolve the rest against the walked path set (exact-case, **not** `existsSync` — case-insensitive
  filesystems would make the verdict OS-dependent).
- **SPEC-04** · non-core · `COLLAPSED` — Every ADR declares a concrete, non-placeholder Status. *Agents
  generate decision records from a template and leave Status blank.* Assess: find ADR files (path/name/
  first-heading rule); extract the Status value; NOT_MET if any is empty or a placeholder token.
- **SPEC-05** · non-core · `COLLAPSED` — Every run command referenced in docs is defined in the project's
  script/target manifest. *Agents document `npm run build` scripts that don't exist.* Assess: extract
  `npm|yarn|pnpm run X` and `make X` from docs; check each against the manifest's script keys / make targets.

## verification integrity (→ 7, intentionally richer)
- **VER-05** · core · `UNOPENED` — The test suite imports at least one module from the project's own
  source tree. *A suite that only imports the test framework proves nothing about the code.*
- **VER-06** · core · `PASSED` — The CI config contains a step that actually invokes a test runner or the
  declared test script. *Agents add CI that lints or builds but never runs the tests.*
- **VER-07** · core · `PASSED` — Total assertion calls ≥ total test-case declarations. *Agents write test
  cases that call the code but assert nothing.* (`require` excluded from the assertion token set.)

## agent boundaries (→ 5)
- **BND-03** · core · `INERT` — Every path the manifest wires up (`main`/`module`/`types`/`exports`/`bin`,
  script file targets) resolves to a file, or is a declared build output. *Agents point `main` at a file
  they never generated.*
- **BND-04** · core · `ECHOED` — No concrete function body is solely a not-implemented placeholder
  (`throw new Error('not implemented')`, a bare `pass`, `TODO`-only). *Agents scaffold signatures and never
  fill them.*
- **BND-05** · non-core · `UNSPENT` — ≤10% of exported symbols are never referenced outside their defining
  file (excluding entrypoints and re-export barrels). *Agents export speculative surface no one uses.*

## human accountability (→ 5)
- **ACC-03** · core · `ECHOED` — The primary README contains no token from a frozen scaffold-placeholder
  list (`lorem ipsum`, `description goes here`, …). *Agents return the generator's default README.*
- **ACC-04** · non-core · `ECHOED` — Any manifest `author`/`description` present is not a known scaffold
  placeholder (`your name`, `a short description of the project`, …).
- **ACC-05** · non-core · `ECHOED` — No commit reachable from HEAD has an author identity matching an
  unconfigured-git/scaffold placeholder (`your name`, `root@localhost`, …). *(git — see determinism rules.)*

## evolvability (→ 3)
- **EVO-02** · non-core · `COLLAPSED` — No source comment carries a defect marker (`FIXME`/`HACK`/`XXX`/
  `BUG`/`BROKEN`/`WIP`) in leading-annotation position. *Distinct from SPEC-02 density; disjoint token set.*
  Assess over comment regions only (string literals stripped).
- **EVO-03** · non-core · `REPEAT` — No normalised 8-line source window appears in two or more locations.
  *Catches whole regenerated functions that the 2-line EVO-01 measures differently.*

## provenance (→ 5) — all git; implement behind the determinism rules
- **PRV-03** · core · `ECHOED` — A non-trivial repo (>3 tracked blobs) has more than one commit reachable
  from HEAD. *A single-commit repo has erased its provenance.*
- **PRV-04** · non-core · `ECHOED` — No root commit already introduces the overwhelming majority of the
  tracked codebase. *The "dump the agent's output as commit 1" pattern.*
- **PRV-05** · non-core · `COLLAPSED` — Fewer than a quarter of commits have an empty or throwaway subject
  (`wip`, `fix`, `updates`, `.`, …).

## Implementation determinism rules (non-negotiable — from the vetting)
- **Case-exact path membership.** SPEC-03 and BND-03 resolve targets against the walk's exact-case path
  set, never `existsSync` — case-insensitive filesystems otherwise make the verdict OS-dependent.
- **Git reads are reachability-only.** PRV-03/04/05 and ACC-05 read **only** commits reachable from HEAD
  and refs via parent links — never all objects under `.git` (dangling/gc'd/reflog objects differ per
  clone). Roots = all parentless reachable commits, tree-blob **union**, no date ordering.
- **Only counts and booleans enter the verdict.** No commit hashes, raw author strings, or timestamps in
  the content-addressed output — or the same repo yields different hashes on different clones.
- **Frozen constant lists.** Every placeholder/marker/subject list is compiled in and closed — an open
  "e.g." list lets two assessors scan for different tokens and diverge. ASCII-only case folding.
- **New `gather()` evidence** (computed once, in the single pass): `walkedPathSet` (exact case), doc link
  targets, ADR files + Status, doc run-commands vs manifest scripts/targets, manifest entrypoints + build
  outputs, per-test import specifiers + assertion/test-case counts, CI command strings, export index +
  code-region reference index, concrete function bodies, comment leading-annotations, 8-line window hashes,
  README content, and the reachable commit graph (counts only).

## Deferred to v0.4 (passed all gates; cut only to keep domains near five)
No-merge-conflict-markers · tracked-path-vs-own-`.gitignore` · licence-file-vs-manifest-licence match ·
tautological-assertion / coverage-floor / focused-test-marker VER checks.

## Dedup notes
SPEC-03 already covers README relative links (no separate ACC link criterion). EVO-02's marker set is
disjoint from SPEC-02's density inputs. PRV-05 subsumes the empty-commit-message check.
