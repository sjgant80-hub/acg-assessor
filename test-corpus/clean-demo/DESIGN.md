# Design — Inventory

## Purpose
A minimal, dependency-free set of pure functions over an in-memory inventory list.

## Model
An inventory is an array of `{ name, quantity, addedAt }`. Functions never mutate their input; they
return new arrays. `name` is the identity of an item.

## Decisions
- Pure functions over a plain array — no class, no store, no I/O — so every path is trivially testable.
- `addItem` records an `addedAt` index for stable ordering without a timestamp (determinism).
- `findItem` returns `null` rather than `undefined` so callers can branch explicitly.
