import { describe, expect, it } from "vitest";

import type { OperationStore, WriteCommand, WriteOperation, WriteQueue } from "@plasius/graph-contracts";
import { HotKeyBatcher, WriteCoordinator } from "../src/write-coordinator.js";

class InMemoryOperationStore implements OperationStore {
  private readonly operations = new Map<string, WriteOperation>();

  async put(operation: WriteOperation): Promise<void> {
    this.operations.set(operation.operationId, operation);
  }

  async get(operationId: string): Promise<WriteOperation | null> {
    return this.operations.get(operationId) ?? null;
  }

  async update(operation: WriteOperation): Promise<void> {
    this.operations.set(operation.operationId, operation);
  }
}

class InMemoryQueue implements WriteQueue {
  public readonly queued: WriteCommand[] = [];
  public readonly acked: string[] = [];
  public readonly nacked: Array<{ operationId: string; reason: string }> = [];

  async enqueue(command: WriteCommand): Promise<WriteOperation> {
    this.queued.push(command);
    return {
      operationId: `queued_${this.queued.length}`,
      state: "queued",
      partitionKey: command.partitionKey,
      aggregateKey: command.aggregateKey,
      acceptedAtEpochMs: command.submittedAtEpochMs,
      updatedAtEpochMs: command.submittedAtEpochMs,
    };
  }

  async dequeue(partitionKey: string, limit: number): Promise<WriteCommand[]> {
    const matches = this.queued.filter((command) => command.partitionKey === partitionKey).slice(0, limit);
    this.queued.splice(0, matches.length);
    return matches;
  }

  async ack(operationId: string): Promise<void> {
    this.acked.push(operationId);
  }

  async nack(operationId: string, reason: string): Promise<void> {
    this.nacked.push({ operationId, reason });
  }
}

describe("WriteCoordinator", () => {
  it("returns succeeded operation in healthy synchronous mode", async () => {
    const coordinator = new WriteCoordinator({
      queue: new InMemoryQueue(),
      operationStore: new InMemoryOperationStore(),
      commitHandler: {
        async commit() {
          return { version: 10 };
        },
      },
      idGenerator: { next: () => "op_1" },
      now: () => 100,
    });

    const operation = await coordinator.submit({
      idempotencyKey: "idk_1",
      partitionKey: "pk_1",
      aggregateKey: "agg_1",
      payload: { value: 1 },
      submittedAtEpochMs: 100,
    });

    expect(operation.state).toBe("succeeded");
    expect(operation.resultVersion).toBe(10);
  });

  it("falls back to queue mode when synchronous commit fails", async () => {
    const queue = new InMemoryQueue();
    const coordinator = new WriteCoordinator({
      queue,
      operationStore: new InMemoryOperationStore(),
      commitHandler: {
        async commit() {
          throw new Error("service unavailable");
        },
      },
      idGenerator: { next: () => "op_2" },
      now: () => 200,
    });

    const operation = await coordinator.submit({
      idempotencyKey: "idk_2",
      partitionKey: "pk_2",
      aggregateKey: "agg_2",
      payload: { value: 2 },
      submittedAtEpochMs: 200,
    });

    expect(operation.state).toBe("queued");
    expect(queue.queued).toHaveLength(1);
  });

  it("falls back to queue mode when synchronous commit times out", async () => {
    const queue = new InMemoryQueue();
    const coordinator = new WriteCoordinator({
      queue,
      operationStore: new InMemoryOperationStore(),
      commitHandler: {
        async commit() {
          return await new Promise(() => {
            // never resolves
          });
        },
      },
      idGenerator: { next: () => "op_timeout" },
      now: () => 250,
      syncTimeoutMs: 1,
    });

    const operation = await coordinator.submit({
      idempotencyKey: "idk_timeout",
      partitionKey: "pk_timeout",
      aggregateKey: "agg_timeout",
      payload: { value: 9 },
      submittedAtEpochMs: 250,
    });

    expect(operation.state).toBe("queued");
    expect(queue.queued).toHaveLength(1);
  });

  it("returns empty partition processing results without commit handler", async () => {
    const queue = new InMemoryQueue();
    await queue.enqueue({
      idempotencyKey: "idk_3",
      partitionKey: "pk_3",
      aggregateKey: "agg_3",
      payload: { value: 3 },
      submittedAtEpochMs: 300,
    });

    const coordinator = new WriteCoordinator({
      queue,
      operationStore: new InMemoryOperationStore(),
      idGenerator: { next: () => "op_3" },
      now: () => 300,
    });

    const operations = await coordinator.processPartition("pk_3", 10);
    expect(operations).toEqual([]);
  });

  it("processes partition commands and records success/failure", async () => {
    let id = 0;
    const queue = new InMemoryQueue();
    queue.queued.push(
      {
        idempotencyKey: "ok",
        partitionKey: "pk_4",
        aggregateKey: "agg_4",
        payload: { value: 4 },
        submittedAtEpochMs: 400,
      },
      {
        idempotencyKey: "fail",
        partitionKey: "pk_4",
        aggregateKey: "agg_4",
        payload: { value: 5 },
        submittedAtEpochMs: 401,
      },
    );

    const coordinator = new WriteCoordinator({
      queue,
      operationStore: new InMemoryOperationStore(),
      commitHandler: {
        async commit(command) {
          if (command.idempotencyKey === "fail") {
            throw new Error("commit failed");
          }
          return { version: 42 };
        },
      },
      idGenerator: { next: () => `op_${++id}` },
      now: () => 400,
    });

    const operations = await coordinator.processPartition("pk_4", 10);

    expect(operations).toHaveLength(2);
    expect(operations[0]?.state).toBe("succeeded");
    expect(operations[0]?.resultVersion).toBe(42);
    expect(operations[1]?.state).toBe("failed");
    expect(operations[1]?.error).toBe("commit failed");
    expect(queue.acked).toEqual(["op_1"]);
    expect(queue.nacked).toEqual([{ operationId: "op_2", reason: "commit failed" }]);
  });

  it("uses default id and clock providers when omitted", async () => {
    const coordinator = new WriteCoordinator({
      queue: new InMemoryQueue(),
      operationStore: new InMemoryOperationStore(),
    });

    const operation = await coordinator.submit({
      idempotencyKey: "idk_default",
      partitionKey: "pk_default",
      aggregateKey: "agg_default",
      payload: { value: 7 },
      submittedAtEpochMs: 700,
    }, { forceQueue: true });

    expect(operation.operationId.startsWith("op_")).toBe(true);
    expect(operation.state).toBe("queued");
  });
});

describe("HotKeyBatcher", () => {
  it("merges partition commands on flush", async () => {
    let now = 0;
    const flushed: Array<{ partitionKey: string; command: WriteCommand }> = [];

    const batcher = new HotKeyBatcher({
      windowMs: 50,
      now: () => now,
      merge(commands) {
        const latest = commands[commands.length - 1]!;
        return {
          idempotencyKey: latest.idempotencyKey,
          partitionKey: latest.partitionKey,
          aggregateKey: latest.aggregateKey,
          submittedAtEpochMs: latest.submittedAtEpochMs,
          actorId: latest.actorId,
          payload: {
            mergedCount: commands.length,
          },
        };
      },
      async onFlush(partitionKey, command) {
        flushed.push({ partitionKey, command });
      },
    });

    await batcher.add({
      idempotencyKey: "1",
      partitionKey: "pk_a",
      aggregateKey: "agg_a",
      payload: { value: 1 },
      submittedAtEpochMs: 0,
    });

    await batcher.add({
      idempotencyKey: "2",
      partitionKey: "pk_a",
      aggregateKey: "agg_a",
      payload: { value: 2 },
      submittedAtEpochMs: 1,
    });

    now = 100;
    await batcher.flushExpired();

    expect(flushed).toHaveLength(1);
    expect(flushed[0]?.partitionKey).toBe("pk_a");
    expect(flushed[0]?.command.payload).toEqual({ mergedCount: 2 });
  });

  it("flushes immediately on add when window has already expired", async () => {
    let now = 0;
    const flushed: Array<{ partitionKey: string; command: WriteCommand }> = [];

    const batcher = new HotKeyBatcher({
      windowMs: 10,
      now: () => now,
      merge(commands) {
        const latest = commands[commands.length - 1]!;
        return {
          idempotencyKey: latest.idempotencyKey,
          partitionKey: latest.partitionKey,
          aggregateKey: latest.aggregateKey,
          submittedAtEpochMs: latest.submittedAtEpochMs,
          actorId: latest.actorId,
          payload: {
            mergedCount: commands.length,
          },
        };
      },
      async onFlush(partitionKey, command) {
        flushed.push({ partitionKey, command });
      },
    });

    await batcher.add({
      idempotencyKey: "1",
      partitionKey: "pk_b",
      aggregateKey: "agg_b",
      payload: { value: 1 },
      submittedAtEpochMs: 0,
    });

    now = 20;
    await batcher.add({
      idempotencyKey: "2",
      partitionKey: "pk_b",
      aggregateKey: "agg_b",
      payload: { value: 2 },
      submittedAtEpochMs: 20,
    });

    expect(flushed).toHaveLength(1);
    expect(flushed[0]?.partitionKey).toBe("pk_b");
    expect(flushed[0]?.command.payload).toEqual({ mergedCount: 2 });
  });

  it("uses default clock when none is provided", async () => {
    const flushed: Array<{ partitionKey: string; command: WriteCommand }> = [];

    const batcher = new HotKeyBatcher({
      windowMs: 0,
      merge(commands) {
        const latest = commands[commands.length - 1]!;
        return {
          idempotencyKey: latest.idempotencyKey,
          partitionKey: latest.partitionKey,
          aggregateKey: latest.aggregateKey,
          submittedAtEpochMs: latest.submittedAtEpochMs,
          actorId: latest.actorId,
          payload: {
            mergedCount: commands.length,
          },
        };
      },
      async onFlush(partitionKey, command) {
        flushed.push({ partitionKey, command });
      },
    });

    await batcher.add({
      idempotencyKey: "1",
      partitionKey: "pk_c",
      aggregateKey: "agg_c",
      payload: { value: 1 },
      submittedAtEpochMs: 0,
    });

    await new Promise((resolve) => setTimeout(resolve, 1));

    await batcher.add({
      idempotencyKey: "2",
      partitionKey: "pk_c",
      aggregateKey: "agg_c",
      payload: { value: 2 },
      submittedAtEpochMs: 1,
    });

    expect(flushed).toHaveLength(1);
    expect(flushed[0]?.partitionKey).toBe("pk_c");
  });
});
