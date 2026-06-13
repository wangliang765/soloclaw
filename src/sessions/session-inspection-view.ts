import type { AuditEvent, Session } from "../domain/index.js";
import { ModelUsageService } from "../model/model-usage-service.js";
import type { AgentStore } from "../store/agent-store.js";

export type SessionOperatorNextActionStatus = "required" | "recommended" | "optional";

export type SessionOperatorNextAction = {
  id: string;
  label: string;
  status: SessionOperatorNextActionStatus;
  command: string;
  reason: string;
};

export type SessionInspectionState = "clean" | "needs_attention" | "blocked";
export type SessionInspectionSeverity = "required" | "warning" | "info";

export type SessionInspectionIssue = {
  id: string;
  label: string;
  severity: SessionInspectionSeverity;
  summary: string;
  command?: string;
};

export type UnifiedDiffChangeType = "added" | "deleted" | "modified" | "renamed";
export type UnifiedDiffReviewSize = "small" | "medium" | "large";

export type UnifiedDiffPathStats = {
  path: string;
  additions: number;
  deletions: number;
};

export type UnifiedDiffFileSummary = UnifiedDiffPathStats & {
  changeType: UnifiedDiffChangeType;
  patches: number;
  firstPatchOrdinal: number;
  lastPatchOrdinal: number;
  reviewSize: UnifiedDiffReviewSize;
  reviewHint: string;
};

export type UnifiedDiffReviewProfile = {
  reviewSize: UnifiedDiffReviewSize | "none";
  reviewHint: string;
  patches: number;
  files: number;
  additions: number;
  deletions: number;
  sizeCounts: Record<UnifiedDiffReviewSize, number>;
  changeTypeCounts: Record<UnifiedDiffChangeType, number>;
  largestFile?: UnifiedDiffPathStats & {
    changedLines: number;
    changeType: UnifiedDiffChangeType;
    reviewSize: UnifiedDiffReviewSize;
  };
};

export type UnifiedDiffStats = {
  files: number;
  additions: number;
  deletions: number;
  byPath: UnifiedDiffPathStats[];
};

export type SessionInspectionSummary = {
  state: SessionInspectionState;
  summary: string;
  issues: SessionInspectionIssue[];
  focusPaths: string[];
  signals: {
    outcome: string;
    recovered: boolean;
    pendingApprovals: number;
    failedCommands: number;
    timedOutCommands: number;
    failedToolResults: number;
    modelFailedCalls: number;
    reviewSize: UnifiedDiffReviewProfile["reviewSize"];
    reviewFiles: number;
  };
};

type SessionInspectionSnapshot = {
  session: Session;
  summary: {
    outcome: ReturnType<typeof sessionResultOutcome>;
    status: Session["status"];
    targetMode: Session["targetMode"];
    recovered: boolean;
    pendingApprovals: number;
    failedCommands: number;
    timedOutCommands: number;
    failedToolResults: number;
    modelFailedCalls: number;
    modelCalls: number;
    reviewProfile: UnifiedDiffReviewProfile;
    nextActionStatuses: Record<string, number>;
  };
  inspection: SessionInspectionSummary;
  nextActions: SessionOperatorNextAction[];
};

export async function buildSessionInspectView(store: AgentStore, sessionId: string) {
  const result = await buildSessionInspectionSnapshot(store, sessionId);
  return {
    generatedAt: new Date().toISOString(),
    session: result.session,
    summary: {
      outcome: result.summary.outcome,
      status: result.summary.status,
      targetMode: result.summary.targetMode,
      recovered: result.summary.recovered,
      inspectionState: result.inspection.state,
      inspectionSummary: result.inspection.summary,
      inspectionIssues: result.inspection.issues.length,
      inspectionIssueSeverities: countInspectionSeverities(result.inspection.issues),
      inspectionFocusPaths: result.inspection.focusPaths,
      pendingApprovals: result.summary.pendingApprovals,
      failedCommands: result.summary.failedCommands,
      timedOutCommands: result.summary.timedOutCommands,
      failedToolResults: result.summary.failedToolResults,
      modelFailedCalls: result.summary.modelFailedCalls,
      reviewProfile: result.summary.reviewProfile,
      nextActions: result.nextActions.length,
      nextActionStatuses: result.summary.nextActionStatuses,
    },
    inspection: result.inspection,
    nextActions: result.nextActions,
    reviewCommands: {
      inspect: `agent session inspect ${sessionId}`,
      result: `agent session result ${sessionId}`,
      review: `agent session review ${sessionId}`,
      status: `agent session status ${sessionId}`,
      diff: `agent session diff ${sessionId}`,
      timeline: `agent session timeline ${sessionId}`,
      report: `agent session report ${sessionId} --json`,
      verify: `agent session verify ${sessionId}`,
      bundle: `agent session bundle ${sessionId} --json`,
      audit: `agent audit list --session ${sessionId}`,
    },
  };
}

async function buildSessionInspectionSnapshot(store: AgentStore, sessionId: string): Promise<SessionInspectionSnapshot> {
  const session = await store.getSession(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const toolResults = await store.getToolResults(sessionId);
  const fileChanges = await store.listFileChanges(sessionId);
  const auditEvents = await store.listAuditEvents({ sessionId, limit: 1000 });
  const modelUsage = await new ModelUsageService(store).summarize({ filters: { sessionId, limit: 1000 } });
  const approvals = (await store.listApprovalRequests())
    .filter((approval) => approval.sessionId === sessionId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const commandEvents = auditEvents
    .filter((event) => event.type === "command.started" || event.type === "command.finished")
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const finishedCommands = commandEvents.filter((event) => event.type === "command.finished");
  const failedCommands = finishedCommands.filter((event) =>
    commandTimedOut(event.metadata) ||
    (commandExitCode(event.metadata) !== undefined && commandExitCode(event.metadata) !== 0)
  );
  const timedOutCommands = finishedCommands.filter((event) => commandTimedOut(event.metadata));
  const firstFailedIndex = finishedCommands.findIndex((event) =>
    commandTimedOut(event.metadata) ||
    (commandExitCode(event.metadata) !== undefined && commandExitCode(event.metadata) !== 0)
  );
  const recoveryCommand = firstFailedIndex >= 0
    ? finishedCommands.slice(firstFailedIndex + 1).find((event) => commandExitCode(event.metadata) === 0 && !commandTimedOut(event.metadata))
    : undefined;
  const lastCommand = finishedCommands.at(-1);
  const outcome = sessionResultOutcome(session.status, commandExitCode(lastCommand?.metadata), commandTimedOut(lastCommand?.metadata));
  const changedPaths = [...new Set(fileChanges.map((change) => change.path))].sort();
  const patchDiffs = sessionPatchAuditEvents(auditEvents).map((event, index) => {
    const patch = auditPatchInput(event.metadata);
    return {
      ordinal: index + 1,
      patch,
      stats: summarizeUnifiedDiffPatch(patch),
    };
  });
  const diffStats = mergeDiffStats(patchDiffs.map((patch) => patch.stats));
  const fileSummaries = summarizeDiffFileSummaries(patchDiffs);
  const reviewProfile = buildDiffReviewProfile({ patches: patchDiffs.length, diffStats, fileSummaries });
  const pendingApprovalIds = approvals.filter((approval) => approval.status === "pending").map((approval) => approval.id);
  const failedToolResults = toolResults.filter((result) => !result.ok);
  const nextActions = buildSessionNextActions(sessionId, {
    outcome,
    sessionStatus: session.status,
    pendingApprovalIds,
    changedPaths,
    patches: patchDiffs.length,
    commandsFinished: finishedCommands.length,
    failedCommands: failedCommands.length,
    timedOutCommands: timedOutCommands.length,
    modelCalls: modelUsage.totals.calls,
    recovered: Boolean(recoveryCommand),
  });
  const inspection = buildSessionInspection(sessionId, {
    outcome,
    recovered: Boolean(recoveryCommand),
    pendingApprovals: pendingApprovalIds.length,
    failedCommands: failedCommands.length,
    timedOutCommands: timedOutCommands.length,
    failedToolResults: failedToolResults.length,
    modelFailedCalls: modelUsage.totals.failedCalls,
    reviewProfile,
    fileSummaries,
  });

  return {
    session,
    summary: {
      outcome,
      status: session.status,
      targetMode: session.targetMode,
      recovered: Boolean(recoveryCommand),
      pendingApprovals: pendingApprovalIds.length,
      failedCommands: failedCommands.length,
      timedOutCommands: timedOutCommands.length,
      failedToolResults: failedToolResults.length,
      modelFailedCalls: modelUsage.totals.failedCalls,
      modelCalls: modelUsage.totals.calls,
      reviewProfile,
      nextActionStatuses: countNextActionStatuses(nextActions),
    },
    inspection,
    nextActions,
  };
}

function buildSessionNextActions(sessionId: string, input: {
  outcome: string;
  sessionStatus: Session["status"];
  pendingApprovalIds: string[];
  changedPaths: string[];
  patches: number;
  commandsFinished: number;
  failedCommands: number;
  timedOutCommands: number;
  modelCalls: number;
  recovered: boolean;
}): SessionOperatorNextAction[] {
  const actions: SessionOperatorNextAction[] = [];
  if (input.pendingApprovalIds.length > 0) {
    const firstApprovalId = input.pendingApprovalIds[0];
    actions.push({
      id: "resolve-pending-approvals",
      label: "Resolve pending approvals",
      status: "required",
      command: firstApprovalId ? `agent approve ${firstApprovalId} --auto-replay` : "agent approvals pending",
      reason: `${input.pendingApprovalIds.length} pending approval request(s) need an operator decision.`,
    });
  }
  if (input.sessionStatus === "paused" || input.outcome === "paused") {
    actions.push({
      id: "resume-session",
      label: "Resume paused session",
      status: "recommended",
      command: `agent resume ${sessionId} --session-result --verify-session`,
      reason: "The session is paused and can be continued from durable state.",
    });
  }
  if (input.outcome === "failed" || (input.failedCommands > 0 && !input.recovered)) {
    actions.push({
      id: "inspect-failure",
      label: "Inspect failed execution",
      status: "required",
      command: `agent session report ${sessionId} --json`,
      reason: `${input.failedCommands} failed command(s) remain unrecovered.`,
    });
  }
  if (input.changedPaths.length > 0 || input.patches > 0) {
    actions.push({
      id: "review-diff",
      label: "Review persisted diff",
      status: "recommended",
      command: `agent session diff ${sessionId}`,
      reason: `${input.changedPaths.length} changed path(s) and ${input.patches} persisted patch(es) are available for review.`,
    });
  }
  if (input.timedOutCommands > 0) {
    actions.push({
      id: "inspect-timeouts",
      label: "Inspect timed-out commands",
      status: "recommended",
      command: `agent session timeline ${sessionId}`,
      reason: `${input.timedOutCommands} command(s) timed out during execution.`,
    });
  }
  actions.push({
    id: "verify-session",
    label: "Run evidence gate",
    status: input.commandsFinished > 0 || input.changedPaths.length > 0 ? "recommended" : "optional",
    command: buildSessionVerifyNextActionCommand(sessionId, input),
    reason: "Verify the session evidence before handoff or archival.",
  });
  actions.push({
    id: "export-bundle",
    label: "Export evidence bundle",
    status: "optional",
    command: `agent session bundle ${sessionId} --json --output .agent/tmp/session-bundle.json`,
    reason: "Package diff, report, status, timeline, review, result, and verification evidence for handoff.",
  });
  return actions;
}

function buildSessionVerifyNextActionCommand(sessionId: string, input: {
  changedPaths: string[];
  patches: number;
  failedCommands: number;
  timedOutCommands: number;
  modelCalls: number;
  recovered: boolean;
}): string {
  const flags = [];
  if (input.changedPaths.length > 0) {
    flags.push("--require-change");
  }
  if (input.patches > 0) {
    flags.push("--require-patch", "--require-diff-stat", "--require-review-profile");
  }
  if (input.failedCommands > 0 && input.recovered) {
    flags.push("--require-recovery");
  }
  if (input.timedOutCommands > 0) {
    flags.push("--require-timeout");
  }
  if (input.modelCalls > 0) {
    flags.push("--require-model-call");
  }
  return `agent session verify ${sessionId}${flags.length > 0 ? ` ${flags.join(" ")}` : ""}`;
}

function countNextActionStatuses(actions: SessionOperatorNextAction[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const action of actions) {
    counts[action.status] = (counts[action.status] ?? 0) + 1;
  }
  return counts;
}

function countInspectionSeverities(issues: SessionInspectionIssue[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const issue of issues) {
    counts[issue.severity] = (counts[issue.severity] ?? 0) + 1;
  }
  return counts;
}

function buildSessionInspection(sessionId: string, input: {
  outcome: string;
  recovered: boolean;
  pendingApprovals: number;
  failedCommands: number;
  timedOutCommands: number;
  failedToolResults: number;
  modelFailedCalls: number;
  reviewProfile: UnifiedDiffReviewProfile;
  fileSummaries: UnifiedDiffFileSummary[];
}): SessionInspectionSummary {
  const issues: SessionInspectionIssue[] = [];
  if (input.outcome !== "succeeded") {
    issues.push({
      id: "session-outcome",
      label: "Session outcome is not succeeded",
      severity: "required",
      summary: `outcome=${input.outcome}`,
      command: `agent session status ${sessionId}`,
    });
  }
  if (input.pendingApprovals > 0) {
    issues.push({
      id: "pending-approvals",
      label: "Pending approvals remain",
      severity: "required",
      summary: `${input.pendingApprovals} pending approval request(s) block a clean handoff.`,
      command: "agent approvals pending",
    });
  }
  if (input.failedCommands > 0 && !input.recovered) {
    issues.push({
      id: "unrecovered-failures",
      label: "Unrecovered command failures",
      severity: "required",
      summary: `${input.failedCommands} failed command(s) were not followed by a successful recovery command.`,
      command: `agent session report ${sessionId} --json`,
    });
  }
  if (input.failedToolResults > 0) {
    issues.push({
      id: "tool-errors",
      label: "Failed tool results",
      severity: "required",
      summary: `${input.failedToolResults} failed tool result(s) need inspection.`,
      command: `agent session timeline ${sessionId}`,
    });
  }
  if (input.modelFailedCalls > 0) {
    issues.push({
      id: "model-failures",
      label: "Model call failures",
      severity: "required",
      summary: `${input.modelFailedCalls} model call(s) failed.`,
      command: `agent models usage --session ${sessionId}`,
    });
  }
  if (input.timedOutCommands > 0) {
    issues.push({
      id: "timeouts",
      label: "Timed-out commands observed",
      severity: "warning",
      summary: `${input.timedOutCommands} command timeout(s) should be reviewed before handoff.`,
      command: `agent session timeline ${sessionId}`,
    });
  }
  if (input.reviewProfile.reviewSize === "medium" || input.reviewProfile.reviewSize === "large") {
    issues.push({
      id: "review-size",
      label: "Broad diff review",
      severity: input.reviewProfile.reviewSize === "large" ? "required" : "warning",
      summary: input.reviewProfile.reviewHint,
      command: `agent session diff ${sessionId}`,
    });
  } else if (input.reviewProfile.files > 0) {
    issues.push({
      id: "diff-review",
      label: "Diff review available",
      severity: "info",
      summary: input.reviewProfile.reviewHint,
      command: `agent session diff ${sessionId}`,
    });
  }

  const required = issues.some((issue) => issue.severity === "required");
  const warning = issues.some((issue) => issue.severity === "warning");
  const state: SessionInspectionState = required ? "blocked" : warning ? "needs_attention" : "clean";
  const focusPaths = input.fileSummaries
    .slice()
    .sort((left, right) => (right.additions + right.deletions) - (left.additions + left.deletions) || left.path.localeCompare(right.path))
    .slice(0, 5)
    .map((entry) => entry.path);
  return {
    state,
    summary:
      state === "clean"
        ? "No blocking inspection issues were found."
        : `${issues.filter((issue) => issue.severity === "required").length} required and ${issues.filter((issue) => issue.severity === "warning").length} warning inspection issue(s).`,
    issues,
    focusPaths,
    signals: {
      outcome: input.outcome,
      recovered: input.recovered,
      pendingApprovals: input.pendingApprovals,
      failedCommands: input.failedCommands,
      timedOutCommands: input.timedOutCommands,
      failedToolResults: input.failedToolResults,
      modelFailedCalls: input.modelFailedCalls,
      reviewSize: input.reviewProfile.reviewSize,
      reviewFiles: input.reviewProfile.files,
    },
  };
}

function sessionResultOutcome(sessionStatus: string, lastCommandExitCode: number | null | undefined, lastCommandTimedOut?: boolean): "succeeded" | "failed" | "paused" | "cancelled" | "in_progress" | "unknown" {
  if (sessionStatus === "completed") {
    return !lastCommandTimedOut && (lastCommandExitCode === undefined || lastCommandExitCode === null || lastCommandExitCode === 0) ? "succeeded" : "failed";
  }
  if (sessionStatus === "failed") {
    return "failed";
  }
  if (sessionStatus === "paused") {
    return "paused";
  }
  if (sessionStatus === "cancelled") {
    return "cancelled";
  }
  if (sessionStatus === "created" || sessionStatus === "running") {
    return "in_progress";
  }
  return "unknown";
}

function commandExitCode(metadata: Record<string, unknown> | undefined): number | null | undefined {
  const value = metadata?.exitCode;
  if (typeof value === "number" || value === null) {
    return value;
  }
  return undefined;
}

function commandTimedOut(metadata: Record<string, unknown> | undefined): boolean {
  return metadata?.timedOut === true;
}

function sessionPatchAuditEvents(auditEvents: AuditEvent[]): AuditEvent[] {
  return auditEvents
    .filter((event) =>
      event.type === "tool.completed" &&
      event.metadata?.tool === "apply_patch" &&
      event.metadata?.ok === true
    )
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function auditPatchInput(metadata: Record<string, unknown> | undefined): string | undefined {
  const input = metadata?.input;
  if (!input || typeof input !== "object") {
    return undefined;
  }
  const patch = (input as Record<string, unknown>).patch;
  return typeof patch === "string" ? patch : undefined;
}

function summarizeUnifiedDiffPatch(patch: string | undefined): UnifiedDiffStats {
  if (!patch) {
    return emptyDiffStats();
  }
  const byPath = new Map<string, UnifiedDiffPathStats>();
  let oldPath: string | undefined;
  let currentPath: string | undefined;
  let inHunk = false;

  for (const line of patch.replace(/\r\n/g, "\n").split("\n")) {
    if (line.startsWith("diff --git ")) {
      oldPath = undefined;
      currentPath = undefined;
      inHunk = false;
      continue;
    }
    if (line.startsWith("--- ")) {
      oldPath = parseUnifiedDiffPath(line, "--- ");
      currentPath = oldPath;
      inHunk = false;
      continue;
    }
    if (line.startsWith("+++ ")) {
      const newPath = parseUnifiedDiffPath(line, "+++ ");
      currentPath = newPath ?? oldPath;
      if (currentPath) {
        ensureDiffPathStats(byPath, currentPath);
      }
      inHunk = false;
      continue;
    }
    if (line.startsWith("@@")) {
      inHunk = true;
      if (currentPath) {
        ensureDiffPathStats(byPath, currentPath);
      }
      continue;
    }
    if (!inHunk || !currentPath) {
      continue;
    }
    if (line.startsWith("+")) {
      ensureDiffPathStats(byPath, currentPath).additions += 1;
    } else if (line.startsWith("-")) {
      ensureDiffPathStats(byPath, currentPath).deletions += 1;
    }
  }

  return diffStatsFromMap(byPath);
}

function mergeDiffStats(stats: UnifiedDiffStats[]): UnifiedDiffStats {
  const byPath = new Map<string, UnifiedDiffPathStats>();
  for (const stat of stats) {
    for (const entry of stat.byPath) {
      const target = ensureDiffPathStats(byPath, entry.path);
      target.additions += entry.additions;
      target.deletions += entry.deletions;
    }
  }
  return diffStatsFromMap(byPath);
}

function ensureDiffPathStats(byPath: Map<string, UnifiedDiffPathStats>, pathName: string): UnifiedDiffPathStats {
  const existing = byPath.get(pathName);
  if (existing) {
    return existing;
  }
  const created = { path: pathName, additions: 0, deletions: 0 };
  byPath.set(pathName, created);
  return created;
}

function diffStatsFromMap(byPath: Map<string, UnifiedDiffPathStats>): UnifiedDiffStats {
  const entries = [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
  return {
    files: entries.length,
    additions: entries.reduce((total, entry) => total + entry.additions, 0),
    deletions: entries.reduce((total, entry) => total + entry.deletions, 0),
    byPath: entries,
  };
}

function emptyDiffStats(): UnifiedDiffStats {
  return { files: 0, additions: 0, deletions: 0, byPath: [] };
}

function buildDiffReviewProfile(input: {
  patches: number;
  diffStats: UnifiedDiffStats;
  fileSummaries: UnifiedDiffFileSummary[];
}): UnifiedDiffReviewProfile {
  const sizeCounts: Record<UnifiedDiffReviewSize, number> = { small: 0, medium: 0, large: 0 };
  const changeTypeCounts: Record<UnifiedDiffChangeType, number> = { added: 0, deleted: 0, modified: 0, renamed: 0 };
  let largestFile: UnifiedDiffReviewProfile["largestFile"];
  for (const summary of input.fileSummaries) {
    sizeCounts[summary.reviewSize] += 1;
    changeTypeCounts[summary.changeType] += 1;
    const changedLines = summary.additions + summary.deletions;
    if (!largestFile || changedLines > largestFile.changedLines || (changedLines === largestFile.changedLines && summary.path.localeCompare(largestFile.path) < 0)) {
      largestFile = {
        path: summary.path,
        additions: summary.additions,
        deletions: summary.deletions,
        changedLines,
        changeType: summary.changeType,
        reviewSize: summary.reviewSize,
      };
    }
  }
  const reviewSize: UnifiedDiffReviewProfile["reviewSize"] =
    input.fileSummaries.length === 0
      ? "none"
      : sizeCounts.large > 0
        ? "large"
        : sizeCounts.medium > 0
          ? "medium"
          : "small";
  const reviewHint = input.fileSummaries.length === 0
    ? "no persisted patch changes"
    : `${reviewSize} review across ${input.diffStats.files} file(s), +${input.diffStats.additions}/-${input.diffStats.deletions}` +
      (largestFile ? `; largest=${largestFile.path} +${largestFile.additions}/-${largestFile.deletions}` : "");

  return {
    reviewSize,
    reviewHint,
    patches: input.patches,
    files: input.diffStats.files,
    additions: input.diffStats.additions,
    deletions: input.diffStats.deletions,
    sizeCounts,
    changeTypeCounts,
    largestFile,
  };
}

function summarizeDiffFileSummaries(patches: Array<{ ordinal: number; patch?: string; stats: UnifiedDiffStats }>): UnifiedDiffFileSummary[] {
  const byPath = new Map<string, {
    path: string;
    additions: number;
    deletions: number;
    patches: number;
    firstPatchOrdinal: number;
    lastPatchOrdinal: number;
    changeTypes: Set<UnifiedDiffChangeType>;
  }>();

  for (const patch of patches) {
    const changeTypes = patch.patch ? extractUnifiedDiffPathChangeTypes(patch.patch) : new Map<string, UnifiedDiffChangeType>();
    for (const entry of patch.stats.byPath) {
      const existing = byPath.get(entry.path);
      const target = existing ?? {
        path: entry.path,
        additions: 0,
        deletions: 0,
        patches: 0,
        firstPatchOrdinal: patch.ordinal,
        lastPatchOrdinal: patch.ordinal,
        changeTypes: new Set<UnifiedDiffChangeType>(),
      };
      target.additions += entry.additions;
      target.deletions += entry.deletions;
      target.patches += 1;
      target.firstPatchOrdinal = Math.min(target.firstPatchOrdinal, patch.ordinal);
      target.lastPatchOrdinal = Math.max(target.lastPatchOrdinal, patch.ordinal);
      target.changeTypes.add(changeTypes.get(entry.path) ?? "modified");
      byPath.set(entry.path, target);
    }
  }

  return [...byPath.values()]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((entry) => {
      const changeType = summarizeChangeTypes(entry.changeTypes);
      const reviewSize = diffReviewSize(entry.additions, entry.deletions);
      return {
        path: entry.path,
        changeType,
        additions: entry.additions,
        deletions: entry.deletions,
        patches: entry.patches,
        firstPatchOrdinal: entry.firstPatchOrdinal,
        lastPatchOrdinal: entry.lastPatchOrdinal,
        reviewSize,
        reviewHint: `${changeType} ${reviewSize} change (+${entry.additions}/-${entry.deletions})`,
      };
    });
}

function summarizeChangeTypes(changeTypes: Set<UnifiedDiffChangeType>): UnifiedDiffChangeType {
  if (changeTypes.size === 1) {
    return [...changeTypes][0] ?? "modified";
  }
  if (changeTypes.has("renamed")) {
    return "renamed";
  }
  return "modified";
}

function diffReviewSize(additions: number, deletions: number): UnifiedDiffReviewSize {
  const changedLines = additions + deletions;
  if (changedLines >= 200) {
    return "large";
  }
  if (changedLines >= 50) {
    return "medium";
  }
  return "small";
}

function extractUnifiedDiffPathChangeTypes(patch: string): Map<string, UnifiedDiffChangeType> {
  const types = new Map<string, UnifiedDiffChangeType>();
  let oldPath: string | undefined;
  for (const line of patch.replace(/\r\n/g, "\n").split("\n")) {
    if (line.startsWith("diff --git ")) {
      oldPath = undefined;
      continue;
    }
    if (line.startsWith("--- ")) {
      oldPath = parseUnifiedDiffPath(line, "--- ");
      continue;
    }
    if (line.startsWith("+++ ")) {
      const newPath = parseUnifiedDiffPath(line, "+++ ");
      const target = newPath ?? oldPath;
      if (target) {
        types.set(target, classifyUnifiedDiffChange(oldPath, newPath));
      }
      oldPath = undefined;
    }
  }
  return types;
}

function classifyUnifiedDiffChange(oldPath: string | undefined, newPath: string | undefined): UnifiedDiffChangeType {
  if (!oldPath && newPath) {
    return "added";
  }
  if (oldPath && !newPath) {
    return "deleted";
  }
  if (oldPath && newPath && oldPath !== newPath) {
    return "renamed";
  }
  return "modified";
}

function parseUnifiedDiffPath(line: string, prefix: "--- " | "+++ "): string | undefined {
  const raw = line.slice(prefix.length).trim();
  if (raw === "/dev/null") {
    return undefined;
  }
  const withoutTimestamp = raw.split("\t")[0].trim();
  const unquoted = withoutTimestamp.startsWith("\"") && withoutTimestamp.endsWith("\"")
    ? withoutTimestamp.slice(1, -1)
    : withoutTimestamp;
  return unquoted.replace(/^(a|b)\//, "");
}
