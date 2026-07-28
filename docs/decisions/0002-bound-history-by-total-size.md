# ADR 0002: Bound Retained History by Total Size and Expose Pagination

## Context

Clients needed historical trade setups in addition to new live records. Retaining and retransmitting an unbounded in-memory history would eventually reduce responsiveness. A simple record-count limit was also imperfect because records varied in size.

## Decision

Preserve the complete logic for every retained trade setup, expose history through pagination, and apply a configurable total-size cutoff to the retained working set.

## Why

- keeps the active working set responsive
- avoids repeatedly sending historical data through the live stream
- preserves complete retained records rather than truncating individual setup logic
- allows clients to request older results deliberately
- makes the retention limit configurable as workloads change

## Tradeoffs

The public service is not an infinite archive. Long-term archival needs should be handled through durable storage and explicit retention policy rather than unbounded live-process memory.

## Operational consequences

Tests should cover pagination boundaries, cutoff behavior, ordering, duplicate records, and client behavior when the retained window changes.
