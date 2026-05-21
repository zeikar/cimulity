# Cimulity Docs

Home for design and subsystem documentation. The root README covers "what the project is and how to start it"; this directory captures **why** decisions were made — models, algorithms, alternatives considered and rejected.

## Layout

- [architecture.md](architecture.md) — layer boundaries, directory structure, coordinate math, camera/picking/render details.
- `systems/` — per-subsystem deep dives (terrain generation, zoning demand, traffic, power, …). Empty for now; new subsystem docs land alongside the systems that need them.

> **Current state:** zone growth, land value, economy, and persistence are already implemented in code but don't yet have subsystem docs — `architecture.md` carries interim summaries for them. A backfill pass will move that detail under `systems/`.

## Conventions

- **One subsystem = one file** (`systems/terrain-generation.md`, `systems/zoning-demand.md`, …).
- **No speculative stubs.** Don't create empty files. New subsystem code lands with its doc; existing undocumented subsystems get cleaned up in a dedicated backfill pass, not piecemeal.
- **Why, not what.** "How it works" is readable from code and tests. Docs focus on the model, formulas, and reasoning.
- **Relative links.** `[architecture.md](architecture.md)`, `[../README.md](../README.md)`.

## Keeping docs in sync

When code changes a doc's claims, run `/hyperclaude:hyper-docs-sync` followed by `/hyperclaude:hyper-docs-review` to refresh and accuracy-check.
