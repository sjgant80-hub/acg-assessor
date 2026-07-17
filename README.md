# The Assessor

**Deterministic rubric assessment for AI-assisted codebases.** Point it at a repository and it
returns a binary verdict — PASS or FAIL — against a published rubric, plus a content hash of that
verdict. Run it again, anywhere, and you get the same hash. Two independent assessors converge on
the same answer **by construction, not by training.**

That is the whole idea. AI has made software cheap to generate and expensive to trust. A rubric
that two careful people can read and still disagree about isn't a standard — it's an opinion with a
logo on it. So the rubric is a program.

```
node assessor.mjs <path-to-repo>
```

Zero dependencies. Vanilla Node (≥18). MIT.

## What it does

- **Binary scoring only.** Every criterion is `MET`, `NOT_MET`, or `N/A` (with a written
  justification). There is no "partially meets" — the moment that exists, two assessors diverge.
- **A published threshold.** Core criteria must all pass; a stated proportion of the rest must pass
  for the badge. Both are printed on every run.
- **A content-addressed verdict.** The whole verdict is hashed. The hash is what you cite, compare
  across time, and re-check when someone claims their repo changed.
- **Seven behavioural tells.** Each criterion is tagged with the agent-code failure mode it detects;
  the verdict names the *dominant tell* — the failure that dominates.

```
node assessor.mjs .            # assess a repo
node assessor.mjs . --json     # machine-readable verdict
node assessor.mjs . --threshold=0.8
node assessor.mjs --fingerprint  # the criteria fingerprint for this spec version
```

Exit code is `0` on PASS, `1` on FAIL — so it drops straight into CI.

## The six domains

Specification integrity · verification integrity · agent boundaries · human accountability ·
evolvability · provenance. Criterion IDs (`SPEC-01`, `VER-02`, …) are **stable and permanent** —
a retired ID is never reused, so a client can cite one for years. The full rubric is in
[`SPEC.md`](SPEC.md).

## It assesses itself

This repository submits to its own rubric. `npm run self` runs the assessor on this repo; it is
expected to **PASS**, and CI fails if it ever doesn't. A standard its authors are exempt from is a
marketing asset; a standard its authors submit to is a standard.

```
npm test            # determinism + the regression corpus + self-assessment + the spec lock
npm run self        # assess this repo
npm run demo:clean  # a clean repo — must PASS
npm run demo:slop   # a deliberately slop repo — must FAIL (exit 1)
```

## Reproducibility and versioning

A verdict only means something relative to the spec version it was issued under. `SPEC_VERSION` is
printed on every verdict, and [`spec-lock.json`](spec-lock.json) pins the criteria fingerprint to
that version. Change a criterion without bumping the version and `npm run check-spec` fails — in CI,
before it can reach anyone. Old versions stay runnable, so any issued verdict stays reproducible.

## What this is *not*

Not a security review. Not a pen test, a vulnerability scan, or a compliance certification. It
assesses **how code is built with agents** — the practice, the workflow, the integrity of the
specification surface — and nothing else. That boundary is in the rubric itself, not just the
contract.

## Licence

MIT. Openly licensed, permissive, forkable — on purpose. See [`LICENSE`](LICENSE). Contributions go
through a PR with a rationale; the [changelog](CHANGELOG.md) says *why*, not just what.
