# ADR-0003: Operation Status Contract and Transition Rules

## Status

- Accepted
- Date: 2026-03-06
- Version: 1.0

## Context

Queue-first degradation requires deterministic write-operation lifecycle behavior so adapters can expose stable `operation_id` polling contracts during upstream failures.

## Decision

- Define explicit allowed state transitions for write operations.
- Route synchronous path through `processing` before terminal states.
- Expose `getOperationStatus(operationId)` with:
  - `found`,
  - terminal flag,
  - recommended status code mapping for host adapters.
- Keep hot-key batching as partition-local micro-batching primitive for high-contention scenarios.

## Consequences

- Host adapters can consistently return `202 + operation_id` while queued.
- Invalid lifecycle jumps are blocked to prevent ambiguous operation state.
- High-contention write behavior is more predictable under parallel load.
