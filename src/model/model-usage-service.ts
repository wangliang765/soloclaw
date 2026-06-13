import type { AuditEvent } from "../domain/index.js";
import type { AgentStore, ListAuditEventsInput } from "../store/agent-store.js";

export type ModelUsageSummaryInput = {
  filters?: Omit<ListAuditEventsInput, "type">;
  provider?: string;
  model?: string;
  inputCostPerMillionTokens?: number;
  outputCostPerMillionTokens?: number;
};

export type ModelUsageSummaryEntry = {
  provider: string;
  model: string;
  calls: number;
  successfulCalls: number;
  failedCalls: number;
  callsWithUsage: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  durationMs: number;
  estimatedCost?: number;
};

export type ModelUsageSummary = {
  entries: ModelUsageSummaryEntry[];
  totals: Omit<ModelUsageSummaryEntry, "provider" | "model">;
  filters: {
    provider?: string;
    model?: string;
    limit?: number;
    sessionId?: string;
    roomId?: string;
    projectId?: string;
    from?: string;
    to?: string;
  };
};

export class ModelUsageService {
  constructor(private readonly store: AgentStore) {}

  async summarize(input: ModelUsageSummaryInput = {}): Promise<ModelUsageSummary> {
    const filters = { ...(input.filters ?? {}), type: "model.called" as const, limit: input.filters?.limit ?? 1000 };
    const events = (await this.store.listAuditEvents(filters)).filter((event) => matchesProviderModel(event, input));
    const groups = new Map<string, ModelUsageSummaryEntry>();

    for (const event of events) {
      const metadata = event.metadata ?? {};
      const provider = stringValue(metadata.provider) ?? "unknown";
      const model = stringValue(metadata.model) ?? "unknown";
      const key = `${provider}\u0000${model}`;
      const entry = groups.get(key) ?? emptyEntry(provider, model);
      const usage = usageValue(metadata.usage);
      entry.calls += 1;
      if (metadata.ok === false) {
        entry.failedCalls += 1;
      } else {
        entry.successfulCalls += 1;
      }
      if (usage) {
        entry.callsWithUsage += 1;
        entry.promptTokens += usage.promptTokens ?? 0;
        entry.completionTokens += usage.completionTokens ?? 0;
        entry.totalTokens += usage.totalTokens ?? (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0);
      }
      entry.durationMs += numberValue(metadata.durationMs) ?? 0;
      groups.set(key, entry);
    }

    const entries = [...groups.values()].sort((left, right) => right.calls - left.calls || left.provider.localeCompare(right.provider) || left.model.localeCompare(right.model));
    for (const entry of entries) {
      applyCost(entry, input);
    }
    const totals = entries.reduce((total, entry) => {
      total.calls += entry.calls;
      total.successfulCalls += entry.successfulCalls;
      total.failedCalls += entry.failedCalls;
      total.callsWithUsage += entry.callsWithUsage;
      total.promptTokens += entry.promptTokens;
      total.completionTokens += entry.completionTokens;
      total.totalTokens += entry.totalTokens;
      total.durationMs += entry.durationMs;
      if (entry.estimatedCost !== undefined) {
        total.estimatedCost = (total.estimatedCost ?? 0) + entry.estimatedCost;
      }
      return total;
    }, emptyEntry("total", "total"));

    return {
      entries,
      totals: stripIdentity(totals),
      filters: {
        provider: input.provider,
        model: input.model,
        limit: filters.limit,
        sessionId: filters.sessionId,
        roomId: filters.roomId,
        projectId: filters.projectId,
        from: filters.from,
        to: filters.to,
      },
    };
  }
}

function matchesProviderModel(event: AuditEvent, input: ModelUsageSummaryInput): boolean {
  if (input.provider && stringValue(event.metadata?.provider) !== input.provider) {
    return false;
  }
  if (input.model && stringValue(event.metadata?.model) !== input.model) {
    return false;
  }
  return true;
}

function emptyEntry(provider: string, model: string): ModelUsageSummaryEntry {
  return {
    provider,
    model,
    calls: 0,
    successfulCalls: 0,
    failedCalls: 0,
    callsWithUsage: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    durationMs: 0,
  };
}

function stripIdentity(entry: ModelUsageSummaryEntry): Omit<ModelUsageSummaryEntry, "provider" | "model"> {
  const { provider: _provider, model: _model, ...rest } = entry;
  return rest;
}

function applyCost(entry: ModelUsageSummaryEntry, input: ModelUsageSummaryInput): void {
  if (input.inputCostPerMillionTokens === undefined && input.outputCostPerMillionTokens === undefined) {
    return;
  }
  entry.estimatedCost =
    (entry.promptTokens * (input.inputCostPerMillionTokens ?? 0)) / 1_000_000 +
    (entry.completionTokens * (input.outputCostPerMillionTokens ?? 0)) / 1_000_000;
}

function usageValue(value: unknown): { promptTokens?: number; completionTokens?: number; totalTokens?: number } | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const usage = {
    promptTokens: numberValue(value.promptTokens),
    completionTokens: numberValue(value.completionTokens),
    totalTokens: numberValue(value.totalTokens),
  };
  return Object.values(usage).some((entry) => entry !== undefined) ? usage : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
