# Working on the Assessor — agent instructions

This repository is built with AI assistance, and it commits the instructions that steer that
assistance. That is itself one of the things the rubric checks (BND-01).

## The one rule that outranks the others

**Determinism is the product.** The entire value of this tool is that the same repository produces
the same verdict and the same hash, on any machine, at any time. Before any change, ask: *could this
make the verdict depend on the clock, the filesystem order, the network, the locale, randomness, or
the operating system?* If yes, it does not go in.

## Rules

- **Zero runtime dependencies.** Vanilla Node ≥18. Do not add an npm dependency. If a task seems to
  need one, it almost certainly does not.
- **Criterion IDs are permanent.** Never reuse or renumber an ID. Retire by removing the entry; the
  number stays retired. New criteria take the next unused number in their domain.
- **Any criterion change bumps `SPEC_VERSION` and re-locks.** Run `npm run check-spec` — it fails if
  the criteria fingerprint drifted from `spec-lock.json` without a version bump. This is not optional;
  it is what makes a client's verdict reproducible.
- **Run the corpus on every change.** `npm test` must stay green: determinism holds, `clean-demo`
  passes, `slop-demo` fails, and this repo passes its own rubric. If `clean-demo` fails a new
  criterion over-fires; if `slop-demo` passes it is toothless.
- **The rubric is public.** No internal or private vocabulary in any committed file. Criteria never
  name a vendor and never assess security — those are hard boundaries, not preferences.
- **Leave it green and leave it clear.** End every change with the build passing and the next step
  written down.

## Layout

```
assessor.mjs                  the assessor: walk → gather → criteria → verdict + hash
SPEC.md                       the rubric in prose (the source of truth for the criteria)
spec-lock.json                criteria fingerprint pinned per spec version
scripts/check-spec-version.mjs  fails if criteria changed without a version bump
tests/                        determinism + corpus + self-assessment + spec lock
test-corpus/                  clean-demo (must pass) + slop-demo (must fail); ignored during self-assessment
```
