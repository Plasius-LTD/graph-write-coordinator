import type {
  IdGenerator,
  OperationStore,
  TelemetrySink,
  Version,
  WriteCommand,
  WriteOperation,
  WriteOperationState,
  WriteQueue,
} from "@plasius/graph-contracts";

export interface WriteCommitResult {
  version: Version;
}

export interface WriteCommitHandler {
  commit(command: WriteCommand): Promise<WriteCommitResult>;
}

export interface WriteCoordinatorOptions {
  queue: WriteQueue;
  operationStore: OperationStore;
  commitHandler?: WriteCommitHandler;
  now?: () => number;
  idGenerator?: IdGenerator;
  syncTimeoutMs?: number;
  telemetry?: TelemetrySink;
}

export interface SubmitWriteOptions {
  forceQueue?: boolean;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isSafeKey = (value: string): boolean => /^[A-Za-z0-9:_-]+$/.test(value);

const isWriteCommandPayloadValid = (value: unknown): value is WriteCommand => {
  if (!isObject(value)) {
    return false;
  }

  if (
    typeof value.idempotencyKey !== "string"
    || value.idempotencyKey.length === 0
    || value.idempotencyKey.length > 128
    || !isSafeKey(value.idempotencyKey)
  ) {
    return false;
  }

  if (
    typeof value.partitionKey !== "string"
    || value.partitionKey.length === 0
    || value.partitionKey.length > 128
    || !isSafeKey(value.partitionKey)
  ) {
    return false;
  }

  if (
    typeof value.aggregateKey !== "string"
    || value.aggregateKey.length === 0
    || value.aggregateKey.length > 256
    || !isSafeKey(value.aggregateKey)
  ) {
    return false;
  }

  if (!isObject(value.payload)) {
    return false;
  }

  if (typeof value.submittedAtEpochMs !== "number" || !Number.isFinite(value.submittedAtEpochMs) || value.submittedAtEpochMs < 0) {
    return false;
  }

  return value.actorId === undefined || (typeof value.actorId === "string" && value.actorId.length > 0 && value.actorId.length <= 128);
};

export interface OperationStatusResponse {
  found: boolean;
  operationId: string;
  operation: WriteOperation | null;
  terminal: boolean;
  recommendedHttpStatus: 200 | 202 | 404 | 409;
}

const TRANSITION_RULES: Record<WriteOperationState, WriteOperationState[]> = {
  accepted: ["processing", "queued", "cancelled"],
  queued: ["processing", "cancelled", "failed"],
  processing: ["queued", "succeeded", "failed", "cancelled"],
  succeeded: [],
  failed: [],
  cancelled: [],
};

export class WriteCoordinator {
  private readonly queue: WriteQueue;
  private readonly operationStore: OperationStore;
  private readonly commitHandler?: WriteCommitHandler;
  private readonly now: () => number;
  private readonly idGenerator: IdGenerator;
  private readonly syncTimeoutMs: number;
  private readonly telemetry?: TelemetrySink;

  public constructor(options: WriteCoordinatorOptions) {
    this.queue = options.queue;
    this.operationStore = options.operationStore;
    this.commitHandler = options.commitHandler;
    this.now = options.now ?? (() => Date.now());
    this.idGenerator = options.idGenerator ?? { next: () => `op_${Math.random().toString(36).slice(2)}` };
    this.syncTimeoutMs = options.syncTimeoutMs ?? 500;
    this.telemetry = options.telemetry;
  }

  public async submit(command: WriteCommand, options: SubmitWriteOptions = {}): Promise<WriteOperation> {
    if (!isWriteCommandPayloadValid(command)) {
      this.telemetry?.metric({
        name: "graph.write.submit.invalid",
        value: 1,
        unit: "count",
      });
      this.telemetry?.error({
        message: "Invalid write command payload",
        source: "graph-write-coordinator",
        code: "WRITE_COMMAND_INVALID",
      });
      throw new Error("Invalid write command payload");
    }

    const startedAt = this.now();
    const now = this.now();
    const accepted: WriteOperation = {
      operationId: this.idGenerator.next(),
      state: "accepted",
      partitionKey: command.partitionKey,
      aggregateKey: command.aggregateKey,
      acceptedAtEpochMs: now,
      updatedAtEpochMs: now,
    };

    await this.operationStore.put(accepted);

    if (!options.forceQueue && this.commitHandler) {
      const processing = this.transitionOperation(accepted, "processing");
      await this.operationStore.update(processing);
      try {
        const commitResult = await this.withTimeout(this.commitHandler.commit(command), this.syncTimeoutMs);
        const completed = this.transitionOperation(processing, "succeeded", {
          resultVersion: commitResult.version,
        });
        await this.operationStore.update(completed);
        this.recordSubmitMetric(completed.state, startedAt);
        return completed;
      } catch {
        // fall through to queue mode
        const queuedFromFallback = this.transitionOperation(processing, "queued");
        await this.operationStore.update(queuedFromFallback);
        await this.queue.enqueue(command);
        this.telemetry?.metric({
          name: "graph.write.submit.degraded",
          value: 1,
          unit: "count",
        });
        this.recordSubmitMetric(queuedFromFallback.state, startedAt);
        return queuedFromFallback;
      }
    }

    const queued = this.transitionOperation(accepted, "queued");
    await this.operationStore.update(queued);
    await this.queue.enqueue(command);
    this.recordSubmitMetric(queued.state, startedAt);
    return queued;
  }

  public async processPartition(partitionKey: string, limit: number): Promise<WriteOperation[]> {
    if (!this.commitHandler) {
      return [];
    }

    const commands = await this.queue.dequeue(partitionKey, limit);
    const operations: WriteOperation[] = [];

    for (const command of commands) {
      const operationId = this.idGenerator.next();
      const processing: WriteOperation = {
        operationId,
        state: "processing",
        partitionKey: command.partitionKey,
        aggregateKey: command.aggregateKey,
        acceptedAtEpochMs: command.submittedAtEpochMs,
        updatedAtEpochMs: this.now(),
      };

      await this.operationStore.put(processing);

      try {
        const result = await this.commitHandler.commit(command);
        const succeeded = this.transitionOperation(processing, "succeeded", {
          resultVersion: result.version,
        });
        await this.operationStore.update(succeeded);
        await this.queue.ack(operationId);
        this.telemetry?.metric({
          name: "graph.write.process.result",
          value: 1,
          unit: "count",
          tags: { state: succeeded.state },
        });
        operations.push(succeeded);
      } catch (error) {
        const failed = this.transitionOperation(processing, "failed", {
          error: error instanceof Error ? error.message : "Unknown commit failure",
        });
        await this.operationStore.update(failed);
        await this.queue.nack(operationId, failed.error ?? "Unknown failure");
        this.telemetry?.metric({
          name: "graph.write.process.result",
          value: 1,
          unit: "count",
          tags: { state: failed.state },
        });
        this.telemetry?.error({
          message: failed.error ?? "Unknown failure",
          source: "graph-write-coordinator",
          code: "WRITE_PROCESS_FAILED",
        });
        operations.push(failed);
      }
    }

    return operations;
  }

  public async getOperationStatus(operationId: string): Promise<OperationStatusResponse> {
    const operation = await this.operationStore.get(operationId);
    if (!operation) {
      this.telemetry?.metric({
        name: "graph.write.status.lookup",
        value: 1,
        unit: "count",
        tags: { found: "false" },
      });
      return {
        found: false,
        operationId,
        operation: null,
        terminal: true,
        recommendedHttpStatus: 404,
      };
    }

    const terminal = operation.state === "succeeded" || operation.state === "failed" || operation.state === "cancelled";
    this.telemetry?.metric({
      name: "graph.write.status.lookup",
      value: 1,
      unit: "count",
      tags: {
        found: "true",
        state: operation.state,
      },
    });
    return {
      found: true,
      operationId,
      operation,
      terminal,
      recommendedHttpStatus: this.statusCodeForState(operation.state),
    };
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;

    const timeoutPromise = new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Write timeout after ${timeoutMs}ms`)), timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private transitionOperation(
    operation: WriteOperation,
    nextState: WriteOperationState,
    patch: Partial<Omit<WriteOperation, "operationId" | "partitionKey" | "aggregateKey" | "acceptedAtEpochMs">> = {},
  ): WriteOperation {
    const allowedTransitions = TRANSITION_RULES[operation.state];
    if (!allowedTransitions.includes(nextState)) {
      throw new Error(`Invalid state transition from ${operation.state} to ${nextState}`);
    }

    return {
      ...operation,
      ...patch,
      state: nextState,
      updatedAtEpochMs: this.now(),
    };
  }

  private statusCodeForState(state: WriteOperationState): 200 | 202 | 409 {
    if (state === "accepted" || state === "queued" || state === "processing") {
      return 202;
    }

    if (state === "failed" || state === "cancelled") {
      return 409;
    }

    return 200;
  }

  private recordSubmitMetric(state: WriteOperationState, startedAt: number): void {
    this.telemetry?.metric({
      name: "graph.write.submit.latency",
      value: this.now() - startedAt,
      unit: "ms",
      tags: { state },
    });
  }
}

export type MergeWriteCommands = (commands: WriteCommand[]) => WriteCommand;

export interface HotKeyBatcherOptions {
  windowMs: number;
  onFlush: (partitionKey: string, command: WriteCommand) => Promise<void>;
  merge: MergeWriteCommands;
  now?: () => number;
}

interface BufferedPartition {
  commands: WriteCommand[];
  deadlineEpochMs: number;
}

export class HotKeyBatcher {
  private readonly windowMs: number;
  private readonly onFlush: HotKeyBatcherOptions["onFlush"];
  private readonly merge: MergeWriteCommands;
  private readonly now: () => number;
  private readonly partitions = new Map<string, BufferedPartition>();

  public constructor(options: HotKeyBatcherOptions) {
    this.windowMs = options.windowMs;
    this.onFlush = options.onFlush;
    this.merge = options.merge;
    this.now = options.now ?? (() => Date.now());
  }

  public async add(command: WriteCommand): Promise<void> {
    const current = this.partitions.get(command.partitionKey);
    if (!current) {
      this.partitions.set(command.partitionKey, {
        commands: [command],
        deadlineEpochMs: this.now() + this.windowMs,
      });
      return;
    }

    current.commands.push(command);
    if (this.now() >= current.deadlineEpochMs) {
      await this.flushPartition(command.partitionKey, current);
    }
  }

  public async flushExpired(): Promise<void> {
    const now = this.now();
    for (const [partitionKey, buffer] of this.partitions.entries()) {
      if (now >= buffer.deadlineEpochMs) {
        await this.flushPartition(partitionKey, buffer);
      }
    }
  }

  private async flushPartition(partitionKey: string, buffer: BufferedPartition): Promise<void> {
    const merged = this.merge(buffer.commands);
    this.partitions.delete(partitionKey);
    await this.onFlush(partitionKey, merged);
  }
}
