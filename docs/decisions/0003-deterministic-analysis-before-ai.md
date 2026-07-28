# ADR 0003: Perform Deterministic Analysis Before AI Synthesis

## Context

Raw exchange data, market structure, liquidation activity, correlations, and risk factors needed to produce consistent analytical records. Asking a language model to infer the entire result directly from raw data would make behavior difficult to reproduce and validate.

## Decision

Run deterministic calculations, rules, scoring, validation, and structured record creation before local or cloud AI synthesis.

## Why

- keeps core calculations reproducible and inspectable
- constrains the model to explanation, synthesis, and presentation
- supports schema validation and malformed-output rejection
- reduces hallucination risk in high-consequence workflows
- allows model providers to change without replacing the analytical foundation

## Tradeoffs

The deterministic layer requires more explicit engineering and maintenance. It can also miss patterns not represented in its rules, so model-assisted synthesis remains useful within bounded responsibilities.

## Operational consequences

Tests should use fixed fixtures for indicators, scoring, schemas, and malformed exchange responses. AI output should be validated against the structured contract before delivery or action.
