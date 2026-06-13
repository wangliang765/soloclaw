import type { OperatorItemView, OperatorViewModel } from "./operator-view-models.js";

export type OperatorDetailView = {
  item?: OperatorItemView;
  matchedBy?: "id" | "ref";
  detailSections: OperatorDetailSection[];
  sourceSummaries: OperatorDetailSourceSummary[];
  sources: Record<string, unknown>;
  missingRefs: string[];
};

export type OperatorDetailSection = {
  title: string;
  rows: Array<{ label: string; value: string }>;
};

export type OperatorDetailSourceSummary = {
  source: string;
  kind: "record" | "list" | "empty" | "value";
  id?: string;
  label?: string;
  status?: string;
  count?: number;
  updatedAt?: string;
};

export type OperatorDetailLoaders = {
  getSession(id: string): Promise<unknown>;
  getSessionMessages(id: string): Promise<unknown>;
  getSessionToolResults(id: string): Promise<unknown>;
  getSessionSummaries(id: string): Promise<unknown>;
  getWorker(id: string): Promise<unknown>;
  getAgent(id: string): Promise<unknown>;
  getArtifact(id: string): Promise<unknown>;
  getRetentionPolicy(id: string): Promise<unknown>;
  getRoom(id: string): Promise<unknown>;
  getAssignment(id: string): Promise<unknown>;
  getSpecification(id: string): Promise<unknown>;
  getSpecificationTasks(id: string): Promise<unknown>;
  getSpecificationPlans(id: string): Promise<unknown>;
  getSpecificationClarifications(id: string): Promise<unknown>;
  getSpecificationVersions(id: string): Promise<unknown>;
  getSpecificationVerifications(id: string): Promise<unknown>;
  getAuditEvent(id: string): Promise<unknown>;
  getMcpServer(id: string): Promise<unknown>;
  getMcpHealth(id: string): Promise<unknown>;
};

export async function buildOperatorDetail(
  itemId: string,
  operator: OperatorViewModel,
  loaders: OperatorDetailLoaders,
): Promise<OperatorDetailView> {
  const match = findOperatorItem(operator, itemId);
  const detail: OperatorDetailView = { item: match?.item, matchedBy: match?.matchedBy, detailSections: [], sourceSummaries: [], sources: {}, missingRefs: [] };
  const item = match?.item;
  if (!item) {
    return detail;
  }
  detail.sources.item = item;
  await addRefSource(detail, "session", item.refs?.sessionId, loaders.getSession);
  if (item.refs?.sessionId) {
    detail.sources.sessionMessages = await loaders.getSessionMessages(item.refs.sessionId);
    detail.sources.sessionToolResults = await loaders.getSessionToolResults(item.refs.sessionId);
    detail.sources.sessionSummaries = await loaders.getSessionSummaries(item.refs.sessionId);
  }
  await addRefSource(detail, "worker", item.refs?.workerId, loaders.getWorker);
  await addRefSource(detail, "agent", item.refs?.agentId, loaders.getAgent);
  await addRefSource(detail, "artifact", item.refs?.artifactId, loaders.getArtifact);
  await addRefSource(detail, "retentionPolicy", item.refs?.retentionPolicyId, loaders.getRetentionPolicy);
  await addRefSource(detail, "room", item.refs?.roomId, loaders.getRoom);
  await addRefSource(detail, "assignment", item.refs?.assignmentId, loaders.getAssignment);

  if (item.refs?.specId) {
    const spec = await loaders.getSpecification(item.refs.specId);
    if (spec) {
      detail.sources.specification = spec;
      detail.sources.specTasks = await loaders.getSpecificationTasks(item.refs.specId);
      detail.sources.specPlans = await loaders.getSpecificationPlans(item.refs.specId);
      detail.sources.specClarifications = await loaders.getSpecificationClarifications(item.refs.specId);
      detail.sources.specVersions = await loaders.getSpecificationVersions(item.refs.specId);
      detail.sources.specVerifications = await loaders.getSpecificationVerifications(item.refs.specId);
    } else {
      detail.missingRefs.push(`specification:${item.refs.specId}`);
    }
  }
  await addRefSource(detail, "auditEvent", item.refs?.auditId, loaders.getAuditEvent);
  await addRefSource(detail, "mcpServer", item.refs?.serverId, loaders.getMcpServer);
  await addRefSource(detail, "mcpHealth", item.refs?.serverId, loaders.getMcpHealth);
  detail.sourceSummaries = Object.entries(detail.sources).map(([source, value]) => summarizeSource(source, value));
  detail.detailSections = buildDetailSections(detail);
  return detail;
}

export function findOperatorItem(operator: OperatorViewModel, itemId: string): { item: OperatorItemView; matchedBy: "id" | "ref" } | undefined {
  const items = operatorSections(operator).flatMap((section) => section.items);
  const byId = items.find((item) => item.id === itemId);
  if (byId) {
    return { item: byId, matchedBy: "id" };
  }
  const byRef = items.find((item) => Object.values(item.refs ?? {}).includes(itemId));
  return byRef ? { item: byRef, matchedBy: "ref" } : undefined;
}

export function operatorSections(operator: OperatorViewModel): Array<{ name: string; items: OperatorItemView[] }> {
  return [
    { name: "queue", items: [operator.queue] },
    { name: "approvals", items: operator.approvals },
    { name: "sessions", items: operator.sessions },
    { name: "assignments", items: operator.assignments },
    { name: "workers", items: operator.workers },
    { name: "agents", items: operator.agents },
    { name: "specs", items: operator.specs },
    { name: "scheduler", items: operator.scheduler },
    { name: "audit", items: operator.audit },
    { name: "artifacts", items: operator.artifacts },
    { name: "retention", items: operator.retention },
    { name: "mcp", items: operator.mcp },
  ];
}

async function addRefSource(
  detail: OperatorDetailView,
  sourceName: string,
  id: string | undefined,
  load: (id: string) => Promise<unknown>,
): Promise<void> {
  if (!id) {
    return;
  }
  const value = await load(id);
  if (value === undefined) {
    detail.missingRefs.push(`${sourceName}:${id}`);
    return;
  }
  detail.sources[sourceName] = value;
}

function summarizeSource(source: string, value: unknown): OperatorDetailSourceSummary {
  if (Array.isArray(value)) {
    return { source, kind: value.length === 0 ? "empty" : "list", count: value.length };
  }
  if (!isRecord(value)) {
    return { source, kind: "value", label: String(value) };
  }
  const label = firstString(value, ["label", "title", "name", "displayName", "objective", "summary", "body", "serverId"]);
  const id = firstString(value, ["id", "sessionId", "workerId", "agentId", "artifactId", "roomId", "specId", "policyId", "serverId"]);
  const status = firstString(value, ["status", "healthState", "trustStatus", "kind"]);
  const updatedAt = firstString(value, ["updatedAt", "lastHeartbeatAt", "lastSeenAt", "createdAt"]);
  return {
    source,
    kind: "record",
    ...(id ? { id } : {}),
    ...(label ? { label } : {}),
    ...(status ? { status } : {}),
    ...(updatedAt ? { updatedAt } : {}),
  };
}

function buildDetailSections(detail: OperatorDetailView): OperatorDetailSection[] {
  const item = detail.item;
  if (!item) {
    return [];
  }
  const sections: OperatorDetailSection[] = [];
  sections.push({
    title: "Overview",
    rows: compactRows([
      ["id", item.id],
      ["kind", item.kind],
      ["status", item.status],
      ["severity", item.severity],
      ["label", item.label],
      ["reason", item.reason],
      ["nextAction", item.nextAction],
      ["updatedAt", item.updatedAt],
      ["matchedBy", detail.matchedBy ?? "id"],
    ]),
  });
  if (item.refs && Object.keys(item.refs).length > 0) {
    sections.push({
      title: "Refs",
      rows: Object.entries(item.refs)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0)
        .map(([label, value]) => ({ label, value })),
    });
  }
  if (item.metadata && Object.keys(item.metadata).length > 0) {
    sections.push({
      title: "Metadata",
      rows: Object.entries(item.metadata).map(([label, value]) => ({ label, value: formatDetailValue(value) })),
    });
  }
  if (detail.sourceSummaries.length > 0) {
    sections.push({
      title: "Sources",
      rows: detail.sourceSummaries.map((summary) => ({
        label: summary.source,
        value: [
          summary.kind,
          summary.id ? `id=${summary.id}` : undefined,
          summary.status ? `status=${summary.status}` : undefined,
          summary.count === undefined ? undefined : `count=${summary.count}`,
          summary.updatedAt ? `updated=${summary.updatedAt}` : undefined,
          summary.label,
        ].filter(Boolean).join(" | "),
      })),
    });
  }
  const workerRows = workerDetailRows(item, detail.sources.worker);
  if (workerRows.length > 0) {
    sections.push({ title: "Worker", rows: workerRows });
  }
  const agentRows = agentDetailRows(item, detail.sources.agent);
  if (agentRows.length > 0) {
    sections.push({ title: "Agent", rows: agentRows });
  }
  const assignmentRows = assignmentDetailRows(item, detail.sources.assignment);
  if (assignmentRows.length > 0) {
    sections.push({ title: "Assignment", rows: assignmentRows });
  }
  const specRows = specificationDetailRows(item, detail.sources.specification, detail.sources.specTasks, detail.sources.specPlans, detail.sources.specClarifications, detail.sources.specVerifications);
  if (specRows.length > 0) {
    sections.push({ title: "Specification", rows: specRows });
  }
  const mcpRows = mcpDetailRows(detail.sources.mcpServer, detail.sources.mcpHealth);
  if (mcpRows.length > 0) {
    sections.push({ title: "MCP", rows: mcpRows });
  }
  return sections.filter((section) => section.rows.length > 0);
}

function workerDetailRows(item: OperatorItemView, worker: unknown): Array<{ label: string; value: string }> {
  if (item.kind !== "worker") {
    return [];
  }
  const record = isRecord(worker) ? worker : undefined;
  return compactRows([
    ["workerId", item.refs?.workerId ?? firstStringFromRecords([record], ["id", "workerId"])],
    ["agentId", item.refs?.agentId ?? firstStringFromRecords([record], ["agentId"])],
    ["status", firstStringFromRecords([record], ["status"]) ?? item.status],
    ["displayName", firstStringFromRecords([record], ["displayName", "name"]) ?? item.label],
    ["loadRatio", item.metadata?.loadRatio],
    ["activeAssignments", item.metadata?.activeAssignments],
    ["queuedAssignments", item.metadata?.queuedAssignments],
    ["delayedRetries", item.metadata?.delayedRetries],
    ["lastHeartbeatAt", firstStringFromRecords([record], ["lastHeartbeatAt", "updatedAt"]) ?? item.updatedAt],
  ]);
}

function agentDetailRows(item: OperatorItemView, agent: unknown): Array<{ label: string; value: string }> {
  if (item.kind !== "agent") {
    return [];
  }
  const record = isRecord(agent) ? agent : undefined;
  return compactRows([
    ["agentId", item.refs?.agentId ?? firstStringFromRecords([record], ["id", "agentId"])],
    ["displayName", firstStringFromRecords([record], ["displayName", "name"]) ?? item.label],
    ["trustStatus", item.metadata?.trustStatus ?? firstStringFromRecords([record], ["trustStatus"])],
    ["machineId", item.metadata?.machineId ?? firstStringFromRecords([record], ["machineId"])],
    ["roomId", item.refs?.roomId],
    ["secondsSinceHeartbeat", item.metadata?.secondsSinceHeartbeat],
    ["lastHeartbeatAt", firstStringFromRecords([record], ["lastHeartbeatAt"]) ?? item.updatedAt],
    ["lastError", firstStringFromRecords([record], ["lastError"])],
  ]);
}

function assignmentDetailRows(item: OperatorItemView, assignment: unknown): Array<{ label: string; value: string }> {
  if (item.kind !== "assignment") {
    return [];
  }
  const record = isRecord(assignment) ? assignment : undefined;
  return compactRows([
    ["assignmentId", item.refs?.assignmentId ?? firstStringFromRecords([record], ["id", "assignmentId"])],
    ["workerId", item.refs?.workerId ?? firstStringFromRecords([record], ["workerId"])],
    ["sessionId", item.refs?.sessionId ?? firstStringFromRecords([record], ["sessionId"])],
    ["subtaskId", item.refs?.subtaskId ?? firstStringFromRecords([record], ["subtaskId"])],
    ["status", firstStringFromRecords([record], ["status"]) ?? item.status],
    ["attempts", item.metadata?.attempts ?? record?.attempts],
    ["leaseExpiresAt", item.metadata?.leaseExpiresAt ?? firstStringFromRecords([record], ["leaseExpiresAt"])],
    ["retryNotBefore", item.metadata?.retryNotBefore],
    ["updatedAt", firstStringFromRecords([record], ["updatedAt"]) ?? item.updatedAt],
  ]);
}

function specificationDetailRows(item: OperatorItemView, spec: unknown, tasks: unknown, plans: unknown, clarifications: unknown, verifications: unknown): Array<{ label: string; value: string }> {
  if (item.kind !== "spec") {
    return [];
  }
  const record = isRecord(spec) ? spec : undefined;
  return compactRows([
    ["specId", item.refs?.specId ?? firstStringFromRecords([record], ["id", "specId"])],
    ["title", firstStringFromRecords([record], ["title"]) ?? item.label],
    ["status", item.metadata?.specStatus ?? firstStringFromRecords([record], ["status"]) ?? item.status],
    ["projectId", item.refs?.projectId ?? firstStringFromRecords([record], ["projectId"])],
    ["roomId", item.refs?.roomId ?? firstStringFromRecords([record], ["roomId"])],
    ["tasks", item.metadata?.totalTasks ?? arrayCount(tasks)],
    ["completedTasks", item.metadata?.completedTasks],
    ["blockedTasks", item.metadata?.blockedTasks],
    ["inProgressTasks", item.metadata?.inProgressTasks],
    ["pendingTasks", item.metadata?.pendingTasks],
    ["openClarifications", item.metadata?.openClarifications ?? arrayCount(clarifications)],
    ["activePlanId", item.metadata?.activePlanId],
    ["plans", arrayCount(plans)],
    ["verifications", arrayCount(verifications)],
  ]);
}

function mcpDetailRows(server: unknown, health: unknown): Array<{ label: string; value: string }> {
  const serverRecord = isRecord(server) ? server : undefined;
  const healthRecord = isRecord(health) ? health : undefined;
  return compactRows([
    ["serverId", firstStringFromRecords([healthRecord, serverRecord], ["serverId", "id"])],
    ["name", firstStringFromRecords([serverRecord], ["name"])],
    ["transport", firstStringFromRecords([healthRecord, serverRecord], ["transport"])],
    ["status", firstStringFromRecords([healthRecord], ["status"])],
    ["reason", firstStringFromRecords([healthRecord], ["reason"])],
    ["planStatus", isRecord(healthRecord?.plan) ? firstString(healthRecord.plan, ["status"]) : undefined],
    ["capabilities", formatDetailValue(serverRecord?.capabilities ?? (isRecord(healthRecord?.capabilities) ? healthRecord.capabilities.declared : undefined))],
    ["diagnostics", formatDetailValue(healthRecord?.diagnostics)],
  ]);
}

function arrayCount(value: unknown): number | undefined {
  return Array.isArray(value) ? value.length : undefined;
}

function compactRows(rows: Array<[string, unknown]>): Array<{ label: string; value: string }> {
  return rows
    .map(([label, value]) => ({ label, value: formatDetailValue(value) }))
    .filter((row) => row.value.length > 0);
}

function formatDetailValue(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => formatDetailValue(entry)).filter(Boolean).join(", ");
  }
  return JSON.stringify(value);
}

function firstStringFromRecords(records: Array<Record<string, unknown> | undefined>, keys: string[]): string | undefined {
  for (const record of records) {
    if (!record) {
      continue;
    }
    const value = firstString(record, keys);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function firstString(value: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
