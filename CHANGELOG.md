# Changelog

All notable changes to this project will be documented in this file.

The format is based on **[Keep a Changelog](https://keepachangelog.com/en/1.1.0/)**, and this project adheres to **[Semantic Versioning](https://semver.org/spec/v2.0.0.html)**.

---

## [Unreleased]

- **Added**
  - Deterministic operation transition rules enforced in coordinator lifecycle.
  - `getOperationStatus(operationId)` query contract with recommended HTTP status mapping.
  - High-contention batching tests for parallel hot-key submissions.
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
