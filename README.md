# @plasius/graph-write-coordinator

[![npm version](https://img.shields.io/npm/v/@plasius/graph-write-coordinator.svg)](https://www.npmjs.com/package/@plasius/graph-write-coordinator)
[![Build Status](https://img.shields.io/github/actions/workflow/status/Plasius-LTD/graph-write-coordinator/ci.yml?branch=main&label=build&style=flat)](https://github.com/Plasius-LTD/graph-write-coordinator/actions/workflows/ci.yml)
[![coverage](https://img.shields.io/codecov/c/github/Plasius-LTD/graph-write-coordinator)](https://codecov.io/gh/Plasius-LTD/graph-write-coordinator)
[![License](https://img.shields.io/github/license/Plasius-LTD/graph-write-coordinator)](./LICENSE)
[![Code of Conduct](https://img.shields.io/badge/code%20of%20conduct-yes-blue.svg)](./CODE_OF_CONDUCT.md)
[![Security Policy](https://img.shields.io/badge/security%20policy-yes-orange.svg)](./SECURITY.md)
[![Changelog](https://img.shields.io/badge/changelog-md-blue.svg)](./CHANGELOG.md)

[![CI](https://github.com/Plasius-LTD/graph-write-coordinator/actions/workflows/ci.yml/badge.svg)](https://github.com/Plasius-LTD/graph-write-coordinator/actions/workflows/ci.yml)
[![CD](https://github.com/Plasius-LTD/graph-write-coordinator/actions/workflows/cd.yml/badge.svg)](https://github.com/Plasius-LTD/graph-write-coordinator/actions/workflows/cd.yml)

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
  commitHandler: {
    async commit(command) {
      return { version: Date.now() };
    },
  },
});

const operation = await coordinator.submit(command);

const batcher = new HotKeyBatcher({
  windowMs: 50,
  merge: (commands) => commands[commands.length - 1]!,
  onFlush: async (partitionKey, merged) => {
    await coordinator.submit(merged, { forceQueue: true });
  },
});

console.log(operation.state);
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

## Architecture

- Package ADRs: [`docs/adrs`](./docs/adrs)
- Cross-package ADRs: `plasius-ltd-site/docs/adrs/adr-0020` to `adr-0024`

---

## License

Licensed under the [Apache-2.0 License](./LICENSE).
