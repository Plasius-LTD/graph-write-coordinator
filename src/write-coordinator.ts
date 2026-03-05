import type {
  IdGenerator,
  OperationStore,
  Version,
  WriteCommand,
  WriteOperation,
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
}

export interface SubmitWriteOptions {
  forceQueue?: boolean;
}

export class WriteCoordinator {
  private readonly queue: WriteQueue;
  private readonly operationStore: OperationStore;
  private readonly commitHandler?: WriteCommitHandler;
  private readonly now: () => number;
  private readonly idGenerator: IdGenerator;
  private readonly syncTimeoutMs: number;

  public constructor(options: WriteCoordinatorOptions) {
    this.queue = options.queue;
    this.operationStore = options.operationStore;
    this.commitHandler = options.commitHandler;
    this.now = options.now ?? (() => Date.now());
    this.idGenerator = options.idGenerator ?? { next: () => `op_${Math.random().toString(36).slice(2)}` };
    this.syncTimeoutMs = options.syncTimeoutMs ?? 500;
  }

  public async submit(command: WriteCommand, options: SubmitWriteOptions = {}): Promise<WriteOperation> {
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
      try {
        const commitResult = await this.withTimeout(this.commitHandler.commit(command), this.syncTimeoutMs);
        const completed: WriteOperation = {
          ...accepted,
          state: "succeeded",
          updatedAtEpochMs: this.now(),
          resultVersion: commitResult.version,
        };
        await this.operationStore.update(completed);
        return completed;
      } catch {
        // fall through to queue mode
      }
    }

    const queued: WriteOperation = {
      ...accepted,
      state: "queued",
      updatedAtEpochMs: this.now(),
    };
    await this.operationStore.update(queued);
    await this.queue.enqueue(command);
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
        const succeeded: WriteOperation = {
          ...processing,
          state: "succeeded",
          updatedAtEpochMs: this.now(),
          resultVersion: result.version,
        };
        await this.operationStore.update(succeeded);
        await this.queue.ack(operationId);
        operations.push(succeeded);
      } catch (error) {
        const failed: WriteOperation = {
          ...processing,
          state: "failed",
          updatedAtEpochMs: this.now(),
          error: error instanceof Error ? error.message : "Unknown commit failure",
        };
        await this.operationStore.update(failed);
        await this.queue.nack(operationId, failed.error ?? "Unknown failure");
        operations.push(failed);
      }
    }

    return operations;
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
