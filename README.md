# @plasius/graph-write-coordinator

[![npm version](https://img.shields.io/npm/v/@plasius/graph-write-coordinator.svg)](https://www.npmjs.com/package/@plasius/graph-write-coordinator)
[![Build Status](https://img.shields.io/github/actions/workflow/status/Plasius-LTD/graph-write-coordinator/ci.yml?branch=main&label=build&style=flat)](https://github.com/Plasius-LTD/graph-write-coordinator/actions/workflows/ci.yml)
[![coverage](https://img.shields.io/codecov/c/github/Plasius-LTD/graph-write-coordinator)](https://codecov.io/gh/Plasius-LTD/graph-write-coordinator)
[![License](https://img.shields.io/github/license/Plasius-LTD/graph-write-coordinator)](./LICENSE)
[![Code of Conduct](https://img.shields.io/badge/code%20of%20conduct-yes-blue.svg)](./CODE_OF_CONDUCT.md)
[![Security Policy](https://img.shields.io/badge/security%20policy-yes-orange.svg)](./SECURITY.md)
[![Changelog](https://img.shields.io/badge/changelog-md-blue.svg)](./CHANGELOG.md)

Queue-first write coordinator with synchronous fast-path, timeout fallback, and hot-key batching.

Apache-2.0. ESM + CJS builds. TypeScript types included.

---

## Requirements

- Node.js 24+ (matches `.nvmrc` and CI/CD)
- `@plasius/graph-contracts`

---

## Installation

```bash
npm install @plasius/graph-write-coordinator
```

---

## Exports

```ts
import {
  WriteCoordinator,
  HotKeyBatcher,
  type WriteCoordinatorOptions,
  type WriteCommitHandler,
  type SubmitWriteOptions,
  type MergeWriteCommands,
} from "@plasius/graph-write-coordinator";
```

---

## Quick Start

```ts
import { WriteCoordinator, HotKeyBatcher } from "@plasius/graph-write-coordinator";

const coordinator = new WriteCoordinator({
  queue,
  operationStore,
  telemetry,
  commitHandler: {
    async commit(command) {
      return { version: Date.now() };
    },
  },
});

const operation = await coordinator.submit(command);
const status = await coordinator.getOperationStatus(operation.operationId);

const batcher = new HotKeyBatcher({
  windowMs: 50,
  merge: (commands) => commands[commands.length - 1]!,
  onFlush: async (partitionKey, merged) => {
    await coordinator.submit(merged, { forceQueue: true });
  },
});

console.log(operation.state, status.recommendedHttpStatus);
```

---

## Development

```bash
npm run clean
npm install
npm run lint
npm run typecheck
npm run test:coverage
npm run build
```

---

## Operation Status Contract

- `submit` validates command shape (`isWriteCommand`) and returns an operation with deterministic state progression.
- Invalid command payloads throw `WriteCommandValidationError`, preserving the
  existing `Invalid write command payload` error message while adding
  `code`, `messageKey`, and `messageDefault` for translated client display.
- `getOperationStatus(operationId)` returns:
  - `found` + `operation`,
  - `terminal` flag,
  - `recommendedHttpStatus` mapping for adapter/HTTP layers.
- Suggested host mapping:
  - `202` for `accepted`/`queued`/`processing`,
  - `200` for `succeeded`,
  - `409` for `failed`/`cancelled`,
  - `404` when operation is unknown.

Register `graphWriteCoordinatorTranslations` with `@plasius/translations` to
resolve package-owned validation text:

```ts
import { createI18n } from "@plasius/translations";
import { graphWriteCoordinatorTranslations } from "@plasius/graph-write-coordinator";

const i18n = createI18n({
  language: "en-GB",
  fallback: "en-GB",
  translations: graphWriteCoordinatorTranslations,
});
```

## Hot-Key Batching

- `HotKeyBatcher` supports localized write collapse by partition key.
- Target window for high-contention workloads is 50-200ms (`windowMs`).
- High-contention tests validate single-window merges under parallel submissions.

## Telemetry

`WriteCoordinatorOptions` accepts optional `telemetry` (`TelemetrySink`) and emits:

- `graph.write.submit.latency`
- `graph.write.submit.degraded`
- `graph.write.process.result`
- `graph.write.status.lookup`

## Queue Acknowledgement Semantics

- When `WriteQueue.dequeue()` returns a command with `queueReceiptId`, the
  coordinator passes that receipt back to `ack()` or `nack()`.
- Receipt-less in-memory queues continue to work because the coordinator falls
  back to the generated processing operation id when no dequeue receipt is
  provided.

---

## Architecture

- Package ADRs: [`docs/adrs`](./docs/adrs)
- Cross-package ADRs: `plasius-ltd-site/docs/adrs/adr-0020` to `adr-0024`

---

## License

Licensed under the [Apache-2.0 License](./LICENSE).

<!-- BEGIN PLASIUS RELEASE INTEGRITY -->
## Release integrity

CI keeps the administrative contributor registry outside Git and npm package
artifacts using exact, case-normalised path checks. Both CI jobs use the literal
`Public CI - Quarantined` group and `[self-hosted, Linux, X64]` labels for trusted
repository pushes only. Fork and PR events cannot schedule self-hosted work.
The group independently restricts repositories and workflow refs; a reviewed
maintainer branch needs a temporary explicit workflow admission, removed after
delivery. Missing capacity fails closed with no hosted fallback. Checkout does
not persist credentials, package-manager cache finalization stays disabled,
and ordinary `npm ci` retains the committed lockfile. Bounded jobs preserve
lint, types, runtime audit, build, 80% line coverage and final pack checks.
Publication uses the GitHub-hosted `production` job with Node 24 and a pinned
npm 11.6.2 client. It is token-free and proceeds only while the prepared SHA
is the exact `main` head after successful push-triggered CI. Do not dispatch CD
until the npm trusted-publisher binding is verified. Use the approved two-phase
`cd.yml` prepare/publish path on `main` with a fresh version; verify exact-main
CI, immutable registry bytes/provenance and the GitHub release before completion.

Feature `platform.public-artifact-integrity.enabled` governs staged public
restoration. Enabled permits verified restoration; disabled pauses restoration;
rollback disables the affected workflow/channel or removes its admission.
Mandatory source/package admission remains enforced in all three states.
No local override or capability is introduced. Never restore the prohibited
administrative path during rollback. See [ADR-0006](docs/adrs/adr-0006-quarantined-push-ci.md).
<!-- END PLASIUS RELEASE INTEGRITY -->
