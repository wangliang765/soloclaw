import { createHash } from "node:crypto";
import type { AuditEvent, AuditExportBundle } from "../domain/index.js";
import { makeId } from "../domain/common.js";
import type { LocalAgentIdentityService } from "../identity/local-agent-identity-service.js";
import type { AgentStore, ListAuditEventsInput } from "../store/agent-store.js";

export type AuditExportFormat = "jsonl" | "json" | "bundle";

export type AuditExportServiceOptions = {
  store: AgentStore;
  identity: LocalAgentIdentityService;
};

export class AuditExportService {
  constructor(private readonly options: AuditExportServiceOptions) {}

  async export(input: { filters: ListAuditEventsInput; format: AuditExportFormat }): Promise<{ count: number; output: string; bundle?: AuditExportBundle }> {
    const events = await this.options.store.listAuditEvents(input.filters);
    if (input.format === "jsonl") {
      return {
        count: events.length,
        output: events.map((event) => JSON.stringify(event)).join("\n") + (events.length > 0 ? "\n" : ""),
      };
    }
    if (input.format === "json") {
      return {
        count: events.length,
        output: `${JSON.stringify({ exportedAt: new Date().toISOString(), count: events.length, events }, null, 2)}\n`,
      };
    }
    const bundle = await this.createBundle(events, input.filters);
    return {
      count: events.length,
      output: `${JSON.stringify(bundle, null, 2)}\n`,
      bundle,
    };
  }

  async createBundle(events: AuditEvent[], filters: ListAuditEventsInput): Promise<AuditExportBundle> {
    const identity = await this.options.identity.getOrCreate();
    const unsigned: Omit<AuditExportBundle, "signature"> = {
      version: 1,
      exportId: makeId("audit_export"),
      createdAt: new Date().toISOString(),
      createdBy: { type: "agent", id: identity.id, displayName: identity.displayName },
      filters: auditExportFiltersSnapshot(filters),
      eventCount: events.length,
      eventsSha256: sha256Hex(stableStringify(events)),
      format: "agent.audit.bundle+json",
      events,
    };
    const signature = await this.options.identity.signAuditExportBundle(unsigned);
    return signature ? { ...unsigned, signature } : unsigned;
  }

  async verifyBundle(bundle: AuditExportBundle): Promise<"valid" | "unsigned" | "unknown_agent" | "invalid"> {
    if (bundle.version !== 1 || bundle.format !== "agent.audit.bundle+json") {
      return "invalid";
    }
    if (bundle.eventCount !== bundle.events.length) {
      return "invalid";
    }
    if (bundle.eventsSha256 !== sha256Hex(stableStringify(bundle.events))) {
      return "invalid";
    }
    return this.options.identity.verifyAuditExportBundle(bundle);
  }
}

export function auditExportFiltersSnapshot(filters: ListAuditEventsInput): AuditExportBundle["filters"] {
  return {
    limit: filters.limit,
    type: filters.type,
    actorId: filters.actorId,
    sessionId: filters.sessionId,
    roomId: filters.roomId,
    projectId: filters.projectId,
    from: filters.from,
    to: filters.to,
  };
}

export function auditEventsSha256(events: AuditEvent[]): string {
  return sha256Hex(stableStringify(events));
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === undefined) {
    return "null";
  }
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}
