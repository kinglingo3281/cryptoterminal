# ADR 0001: Use Server-Sent Events for One-Way Live Delivery

## Context

Authenticated clients needed a continuous stream of newly created analytical records. The dominant communication pattern was server-to-client delivery, while commands and historical queries could continue through normal request/response APIs.

## Decision

Use Server-Sent Events for the live one-way channel.

## Why

- matches the primary server-to-client communication pattern
- works over standard HTTP infrastructure
- provides built-in browser reconnection semantics
- keeps the live-delivery path simpler than a full bidirectional socket protocol
- allows history and commands to remain separate, explicit endpoints

## Tradeoffs

SSE is not ideal for high-frequency bidirectional messaging or binary frames. It also requires careful client cleanup, authentication handling, proxy configuration, heartbeat behavior, and reconnect testing.

## Operational consequences

The service needs client tracking, disconnect cleanup, health checks, reconnect behavior, and protection against duplicate delivery after reconnection.
