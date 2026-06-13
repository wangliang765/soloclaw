export type DaemonServiceKind = "worker" | "scheduler";

export type DaemonLifecyclePhase =
  | "created"
  | "starting"
  | "running"
  | "idle"
  | "draining"
  | "shutting_down"
  | "stopped";

export type DaemonStopReason =
  | "completed"
  | "max_ticks"
  | "limit_reached"
  | "idle"
  | "aborted"
  | "shutdown_requested"
  | "worker_not_runnable"
  | "paused_assignment"
  | "drain_completed";

export type DaemonLoopMetrics = {
  tickCount: number;
  idleCount: number;
  activeLeases?: number;
  queueDepth?: number;
  delayedRetries?: number;
  recoveredExpired?: number;
  retriesScheduled?: number;
  failures?: number;
  heartbeatAgeMs?: number;
  loopLatencyMs?: number;
  drainBlocked?: number;
  assignmentsCompleted?: number;
};

export type DaemonLifecycleSnapshot = {
  service: DaemonServiceKind;
  phase: DaemonLifecyclePhase;
  startedAt?: string;
  stoppedAt?: string;
  stopReason?: DaemonStopReason;
  drainRequestedAt?: string;
  shutdownRequestedAt?: string;
  lastTickAt?: string;
  metrics: DaemonLoopMetrics;
};

export type DaemonLifecycleEvent = {
  service: DaemonServiceKind;
  phase: DaemonLifecyclePhase;
  type: "started" | "tick" | "idle" | "drain_requested" | "shutdown_requested" | "stopped";
  generatedAt: string;
  reason?: string;
  snapshot: DaemonLifecycleSnapshot;
};

export class DaemonLifecycleController {
  private phase: DaemonLifecyclePhase = "created";
  private startedAt?: string;
  private stoppedAt?: string;
  private stopReason?: DaemonStopReason;
  private drainRequestedAt?: string;
  private shutdownRequestedAt?: string;
  private lastTickAt?: string;
  private metrics: DaemonLoopMetrics = { tickCount: 0, idleCount: 0 };
  private readonly listeners: Array<(event: DaemonLifecycleEvent) => void | Promise<void>> = [];

  constructor(private readonly service: DaemonServiceKind) {}

  onEvent(listener: (event: DaemonLifecycleEvent) => void | Promise<void>): void {
    this.listeners.push(listener);
  }

  snapshot(): DaemonLifecycleSnapshot {
    return {
      service: this.service,
      phase: this.phase,
      startedAt: this.startedAt,
      stoppedAt: this.stoppedAt,
      stopReason: this.stopReason,
      drainRequestedAt: this.drainRequestedAt,
      shutdownRequestedAt: this.shutdownRequestedAt,
      lastTickAt: this.lastTickAt,
      metrics: { ...this.metrics },
    };
  }

  get isShutdownRequested(): boolean {
    return this.shutdownRequestedAt !== undefined;
  }

  async start(now = new Date().toISOString()): Promise<void> {
    this.phase = "running";
    this.startedAt = now;
    this.stoppedAt = undefined;
    this.stopReason = undefined;
    await this.emit("started", now);
  }

  async recordTick(metrics: Partial<DaemonLoopMetrics>, now = new Date().toISOString()): Promise<void> {
    const { tickCount: _tickCount, idleCount: _idleCount, ...tickMetrics } = metrics;
    this.lastTickAt = now;
    this.metrics = {
      ...this.metrics,
      ...tickMetrics,
      loopLatencyMs: addMetric(this.metrics.loopLatencyMs, tickMetrics.loopLatencyMs),
      recoveredExpired: addMetric(this.metrics.recoveredExpired, tickMetrics.recoveredExpired),
      retriesScheduled: addMetric(this.metrics.retriesScheduled, tickMetrics.retriesScheduled),
      delayedRetries: addMetric(this.metrics.delayedRetries, tickMetrics.delayedRetries),
      failures: addMetric(this.metrics.failures, tickMetrics.failures),
      drainBlocked: addMetric(this.metrics.drainBlocked, tickMetrics.drainBlocked),
      assignmentsCompleted: addMetric(this.metrics.assignmentsCompleted, tickMetrics.assignmentsCompleted),
      tickCount: this.metrics.tickCount + 1,
    };
    if (this.phase !== "draining" && this.phase !== "shutting_down") {
      this.phase = "running";
    }
    await this.emit("tick", now);
  }

  async recordIdle(now = new Date().toISOString()): Promise<void> {
    this.phase = this.phase === "shutting_down" ? "shutting_down" : "idle";
    this.metrics = {
      ...this.metrics,
      idleCount: this.metrics.idleCount + 1,
    };
    await this.emit("idle", now);
  }

  async requestDrain(reason?: string, now = new Date().toISOString()): Promise<void> {
    this.phase = "draining";
    this.drainRequestedAt = now;
    await this.emit("drain_requested", now, reason);
  }

  async requestShutdown(reason?: string, now = new Date().toISOString()): Promise<void> {
    this.phase = "shutting_down";
    this.shutdownRequestedAt = now;
    await this.emit("shutdown_requested", now, reason);
  }

  async stop(reason: DaemonStopReason, now = new Date().toISOString()): Promise<void> {
    this.phase = "stopped";
    this.stoppedAt = now;
    this.stopReason = reason;
    await this.emit("stopped", now, reason);
  }

  private async emit(type: DaemonLifecycleEvent["type"], now: string, reason?: string): Promise<void> {
    const event: DaemonLifecycleEvent = {
      service: this.service,
      phase: this.phase,
      type,
      generatedAt: now,
      reason,
      snapshot: this.snapshot(),
    };
    for (const listener of this.listeners) {
      await listener(event);
    }
  }
}

function addMetric(current: number | undefined, next: number | undefined): number | undefined {
  if (current === undefined && next === undefined) {
    return undefined;
  }
  return (current ?? 0) + (next ?? 0);
}
