# ADR 0004: Use Planned Service Renewal as a Resilience Policy

## Context

The platform depended on exchanges, market-data providers, networks, wallet infrastructure, and emerging SDKs outside the team's control. Long-running services could accumulate stale connections or enter degraded states even without a confirmed application memory leak.

## Decision

Use controlled, planned service renewal alongside health checks, watchdogs, logs, alerts, reconnect behavior, and recovery routines.

## Why

- limits the lifetime of stale external connections
- creates predictable recovery points
- reduces dependence on perfect behavior from outside providers
- complements monitoring rather than replacing diagnosis
- is common operational defense for long-running integration services

## Rejected interpretation

Planned renewal should not be described as a workaround for a known memory leak. No such leak was the reason for the policy.

## Operational consequences

Renewal must be graceful, observable, and coordinated with process supervision so clients reconnect and in-flight work is handled safely.
