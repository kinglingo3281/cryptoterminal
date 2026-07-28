# AI-Assisted Development

## Purpose

I use AI coding agents as implementation accelerators, not as substitutes for product ownership or engineering judgment. The goal is to move faster while preserving clear requirements, security boundaries, verification, and responsibility for what ships.

## Problem framing before agent work

Before delegating implementation work, I define:

- the user or operational problem
- system boundaries and affected components
- inputs, outputs, and data contracts
- security and privacy constraints
- acceptance criteria and failure cases
- how the change will be tested and verified

## Good tasks for coding agents

- library and API research
- scaffolding and repetitive integration work
- focused refactors with a defined behavioral contract
- documentation drafts
- test generation around specified behavior
- targeted debugging and reproduction helpers
- comparing implementation approaches across unfamiliar libraries

## Human-owned decisions

I personally own:

- product requirements and prioritization
- architecture and system boundaries
- browser-visible versus server-side security boundaries
- execution safeguards and high-consequence workflows
- data models, contracts, and failure behavior
- UX and operator clarity
- deployment and recovery behavior
- final acceptance

## Verification loop

1. Inspect the proposed diff rather than accepting output by summary.
2. Run lint, type checks, focused tests, and a production build where applicable.
3. Exercise high-risk manual cases, especially account, wallet, order, position, authentication, and reconnect flows.
4. Verify secrets and private configuration remain outside browser and repository boundaries.
5. Compare behavior against the original acceptance criteria.
6. Reject or revise generated output that is unclear, fragile, unnecessarily broad, or insufficiently verified.

## Production ownership

AI may shorten implementation time, but I remain responsible for logs, monitoring, incident diagnosis, rollback and recovery, support, and the actual behavior users experience.

## Honest ownership statement

I used AI extensively as an implementation accelerator, especially when working across unfamiliar libraries or large integration surfaces. I personally owned the product architecture, requirements, UX, system boundaries, integration decisions, debugging, production behavior, and final acceptance. The trading terminal was independently architected and built by me. AI shortened implementation time; it did not determine what the product needed to do or whether it worked safely in production.
