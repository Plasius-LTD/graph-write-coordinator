# ADR-0004: Write Coordinator Telemetry Baseline

## Status

- Accepted
- Date: 2026-03-06
- Version: 1.0

## Context

Queue-first degradation requires clear visibility into submit latency, degraded fallback frequency, processing failures, and status-lookup traffic.

## Decision

- Add optional telemetry sink to `WriteCoordinatorOptions`.
- Emit metrics for submit latency/degradation, processing results, and status lookups.
- Emit structured errors when partition processing fails.

## Consequences

- Write-path degradation and failure conditions are observable in near real time.
- Telemetry remains host-configurable with no adapter lock-in.
