import type { OperatorDetailView } from "./operator-detail.js";
import type { OperatorItemView, OperatorViewModel } from "./operator-view-models.js";

export type OperatorProjectionMode = "diagnostic" | "public";

export type OperatorProjectionOptions = {
  mode?: OperatorProjectionMode;
};

export function projectOperatorView(operator: OperatorViewModel, options: OperatorProjectionOptions = {}): OperatorViewModel {
  if ((options.mode ?? "diagnostic") === "diagnostic") {
    return operator;
  }
  return {
    ...operator,
    approvals: operator.approvals.map(projectOperatorItem),
    assignments: operator.assignments.map(projectOperatorItem),
    workers: operator.workers.map(projectOperatorItem),
    agents: operator.agents.map(projectOperatorItem),
    sessions: operator.sessions.map(projectOperatorItem),
    specs: operator.specs.map(projectOperatorItem),
    artifacts: operator.artifacts.map(projectOperatorItem),
    retention: operator.retention.map(projectOperatorItem),
    scheduler: operator.scheduler.map(projectOperatorItem),
    audit: operator.audit.map(projectOperatorItem),
    queue: projectOperatorItem(operator.queue),
    mcp: operator.mcp.map(projectOperatorItem),
  };
}

export function projectOperatorDetail(detail: OperatorDetailView, options: OperatorProjectionOptions = {}): OperatorDetailView {
  if ((options.mode ?? "diagnostic") === "diagnostic") {
    return detail;
  }
  return {
    item: detail.item ? projectOperatorItem(detail.item) : undefined,
    matchedBy: detail.matchedBy,
    detailSections: detail.detailSections.filter((section) => section.title !== "Refs" && section.title !== "Metadata"),
    sourceSummaries: detail.sourceSummaries,
    sources: {},
    missingRefs: [],
  };
}

function projectOperatorItem(item: OperatorItemView): OperatorItemView {
  const { refs: _refs, metadata: _metadata, ...safe } = item;
  return safe;
}
