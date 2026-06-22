# Changelog

All notable changes to this project will be documented in this file.

The format is based on **[Keep a Changelog](https://keepachangelog.com/en/1.1.0/)**, and this project adheres to **[Semantic Versioning](https://semver.org/spec/v2.0.0.html)**.

---

## [Unreleased]

- **Added**
  - (placeholder)

- **Changed**
  - (placeholder)

- **Fixed**
  - (placeholder)

- **Security**
  - (placeholder)

## [0.1.10] - 2026-06-22

- **Added**
  - (placeholder)

- **Changed**
  - (placeholder)

- **Fixed**
  - (placeholder)

- **Security**
  - (placeholder)

## [0.1.9] - 2026-06-22

- **Added**
  - Added `en-GB` translation keys/defaults for invalid write command validation text.

- **Changed**
  - Invalid write command failures now expose `messageKey` and `messageDefault` on `WriteCommandValidationError`.
  - `processPartition()` now prefers a dequeued queue receipt for `ack()` and `nack()` when the queue provides one.

- **Fixed**
  - Restored the package CD workflow so protected main releases are prepared by PR and published without direct branch pushes.
  - Prevented durable queues from incorrectly acknowledging generated processing operation ids instead of dequeued queue receipts.

- **Security**
  - (placeholder)

## [0.1.6] - 2026-05-13

- **Added**
  - (placeholder)

- **Changed**
  - Refreshed dependencies to the latest stable published versions.
  - (placeholder)

- **Fixed**
  - (placeholder)

- **Security**
  - (placeholder)

## [0.1.5] - 2026-05-13

- **Added**
  - (placeholder)

- **Changed**
  - (placeholder)

- **Fixed**
  - (placeholder)

- **Security**
  - (placeholder)

## [0.1.4] - 2026-04-21

- **Added**
  - (placeholder)

- **Changed**
  - (placeholder)

- **Fixed**
  - (placeholder)

- **Security**
  - (placeholder)

## [0.1.3] - 2026-04-02

- **Added**
  - (placeholder)

- **Changed**
  - (placeholder)

- **Fixed**
  - (placeholder)

- **Security**
  - (placeholder)

## [0.1.2] - 2026-03-06

- **Added**
  - Deterministic operation transition rules enforced in coordinator lifecycle.
  - `getOperationStatus(operationId)` query contract with recommended HTTP status mapping.
  - Optional telemetry sink support for submit/process/status observability.
  - Fast-fail write command validation (`isWriteCommand`) at submit boundary.
  - High-contention batching tests for parallel hot-key submissions.
  - Telemetry emission tests for submit/degraded/process/status paths.
  - ADR-0003 documenting status contract and transition policy.

- **Changed**
  - Synchronous commit path now transitions through `processing` before terminal outcomes.
  - README now documents degraded-mode operation polling contract.

- **Fixed**
  - N/A

- **Security**
  - N/A

## [0.1.1] - 2026-03-05

### Added

- Initial package scaffolding.
- Initial source implementation and baseline tests.
- CI/CD workflow baseline for GitHub Actions and npm publish path.


[0.1.1]: https://github.com/Plasius-LTD/graph-write-coordinator/releases/tag/v0.1.1
[0.1.2]: https://github.com/Plasius-LTD/graph-write-coordinator/releases/tag/v0.1.2
[0.1.3]: https://github.com/Plasius-LTD/graph-write-coordinator/releases/tag/v0.1.3
[0.1.4]: https://github.com/Plasius-LTD/graph-write-coordinator/releases/tag/v0.1.4
[0.1.5]: https://github.com/Plasius-LTD/graph-write-coordinator/releases/tag/v0.1.5
[0.1.6]: https://github.com/Plasius-LTD/graph-write-coordinator/releases/tag/v0.1.6
[0.1.9]: https://github.com/Plasius-LTD/graph-write-coordinator/releases/tag/v0.1.9
[0.1.10]: https://github.com/Plasius-LTD/graph-write-coordinator/releases/tag/v0.1.10
