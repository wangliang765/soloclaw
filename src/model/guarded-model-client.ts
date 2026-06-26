import type { ModelClient, ModelRequest, ModelStreamEvent } from "./model-client.js";
import type { ModelResponse } from "../protocol/types.js";

export type ModelReliabilityGuardOptions = {
  maxCalls?: number;
  maxFailures?: number;
  circuitBreakAfterFailures?: number;
  circuitOpenMs?: number;
  now?: () => number;
};

export class ModelBudgetExceededError extends Error {
  constructor(
    message: string,
    readonly reason: "max_calls" | "max_failures",
  ) {
    super(message);
    this.name = "ModelBudgetExceededError";
  }
}

export class ModelCircuitOpenError extends Error {
  constructor(
    message: string,
    readonly openUntil: string,
  ) {
    super(message);
    this.name = "ModelCircuitOpenError";
  }
}

export class GuardedModelClient implements ModelClient {
  private totalCalls = 0;
  private totalFailures = 0;
  private consecutiveFailures = 0;
  private circuitOpenUntilMs = 0;

  constructor(
    private readonly inner: ModelClient,
    private readonly options: ModelReliabilityGuardOptions,
  ) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    return this.runGuarded(() => this.inner.complete(request));
  }

  async *streamComplete(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    const stream = await this.runGuarded(async () => this.inner.streamComplete?.(request));
    if (stream) {
      yield* stream;
      return;
    }
    yield await this.inner.complete(request);
  }

  private async runGuarded<T>(action: () => Promise<T>): Promise<T> {
    const now = this.now();
    if (this.circuitOpenUntilMs > now) {
      throw new ModelCircuitOpenError("Model circuit is open after repeated failures.", new Date(this.circuitOpenUntilMs).toISOString());
    }
    if (this.options.maxCalls !== undefined && this.totalCalls >= this.options.maxCalls) {
      throw new ModelBudgetExceededError("Model call budget exhausted.", "max_calls");
    }
    if (this.options.maxFailures !== undefined && this.totalFailures >= this.options.maxFailures) {
      throw new ModelBudgetExceededError("Model failure budget exhausted.", "max_failures");
    }

    this.totalCalls += 1;
    try {
      const response = await action();
      this.consecutiveFailures = 0;
      return response;
    } catch (error) {
      this.totalFailures += 1;
      this.consecutiveFailures += 1;
      if (this.shouldOpenCircuit()) {
        this.circuitOpenUntilMs = this.now() + (this.options.circuitOpenMs ?? 60_000);
      }
      throw error;
    }
  }

  snapshot() {
    return {
      totalCalls: this.totalCalls,
      totalFailures: this.totalFailures,
      consecutiveFailures: this.consecutiveFailures,
      circuitOpenUntil: this.circuitOpenUntilMs > 0 ? new Date(this.circuitOpenUntilMs).toISOString() : undefined,
    };
  }

  private shouldOpenCircuit(): boolean {
    return Boolean(
      this.options.circuitBreakAfterFailures !== undefined &&
        this.options.circuitBreakAfterFailures > 0 &&
        this.consecutiveFailures >= this.options.circuitBreakAfterFailures,
    );
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}

export function hasModelReliabilityGuards(options: ModelReliabilityGuardOptions): boolean {
  return (
    options.maxCalls !== undefined ||
    options.maxFailures !== undefined ||
    options.circuitBreakAfterFailures !== undefined ||
    options.circuitOpenMs !== undefined
  );
}
