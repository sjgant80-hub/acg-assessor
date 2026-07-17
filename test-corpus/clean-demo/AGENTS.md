# Agent instructions — Inventory

- Keep every function pure: take input, return new data, never mutate arguments, no I/O.
- No dependencies. If a change seems to need one, reconsider the change.
- Every exported function has at least one test that exercises a real path.
- Determinism: never introduce a clock, random value, or ordering that depends on the environment.
