# Changelog

The changelog says *why*, not just what. When a criterion changes because it met a real codebase and
lost, the entry names the failure that caused it.

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
