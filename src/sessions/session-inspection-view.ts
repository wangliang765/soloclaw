import type { AuditEvent, FileChange, PolicyAction, Session } from "../domain/index.js";
import { ModelUsageService } from "../model/model-usage-service.js";
import type { AgentStore } from "../store/agent-store.js";
import type { CommandExecutionProfileName } from "../workspace/workspace-runtime.js";
import { buildSessionTimelineView } from "./session-timeline-view.js";

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

export type SessionHandoffState = "ready" | "blocked" | "needs_attention" | "in_progress";

export type SessionHandoffSummary = {
  state: SessionHandoffState;
  summary: string;
  requiredIssues: number;
  warningIssues: number;
  requiredActions: number;
  recommendedActions: number;
  nextCommand?: string;
  reviewCommand: string;
  verificationCommand: string;
  bundleCommand: string;
  focusPaths: string[];
};

export type SessionDashboardOptions = {
  limit?: number;
  status?: Session["status"];
  targetMode?: Session["targetMode"];
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

export type UnifiedDiffInspectionPlanState = "none" | "ready";

export type UnifiedDiffInspectionPlanItem = UnifiedDiffPathStats & {
  priority: number;
  changedLines: number;
  changeType: UnifiedDiffChangeType;
  patches: number;
  reviewSize: UnifiedDiffReviewSize;
  reason: string;
  command: string;
};

export type UnifiedDiffInspectionPlan = {
  state: UnifiedDiffInspectionPlanState;
  summary: string;
  focusPaths: string[];
  commands: {
    diff: string;
    review: string;
    result: string;
  };
  items: UnifiedDiffInspectionPlanItem[];
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
    changedPaths: string[];
    fileChanges: number;
    patches: number;
    commandsFinished: number;
    failedCommands: number;
    timedOutCommands: number;
    toolResults: number;
    failedToolResults: number;
    executionProfiles: Record<string, number>;
    diffStats: UnifiedDiffStats;
    fileSummaries: UnifiedDiffFileSummary[];
    modelFailedCalls: number;
    modelCalls: number;
    modelSuccessfulCalls: number;
    modelCallsWithUsage: number;
    modelTotalTokens: number;
    finalAnswerChars: number;
    finalAnswerState: "visible" | "empty" | "missing";
    runtimeStops: number;
    lastRuntimeStopKind?: string;
    lastRuntimeStopReason?: string;
    resumeCommand?: string;
    reviewProfile: UnifiedDiffReviewProfile;
    nextActionStatuses: Record<string, number>;
    lastCommand?: SessionCommandSummary;
  };
  inspection: SessionInspectionSummary;
  nextActions: SessionOperatorNextAction[];
  commands: SessionCommandSummary[];
  recovery: SessionRecoverySummary;
  approvals: SessionApprovalSummary[];
};

export type SessionReviewChecklistItem = {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail" | "not_needed";
  summary: string;
  command?: string;
};

export type SessionCommandSummary = {
  ordinal: number;
  status: "pass" | "fail" | "timeout" | "unknown";
  command?: string;
  exitCode?: number | null;
  timedOut: boolean;
  durationMs?: number;
  executionProfile?: string;
  createdAt: string;
  stdoutBytes?: number;
  stderrBytes?: number;
};

export type SessionRecoverySummary = {
  observedFailure: boolean;
  recovered: boolean;
  firstFailedCommand?: SessionCommandSummary;
  recoveryCommand?: SessionCommandSummary;
};

export type SessionApprovalSummary = {
  id: string;
  status: string;
  action: string;
  toolName?: string;
  reason: string;
  createdAt: string;
  decidedAt?: string;
};

export type SessionPatchSummary = {
  ordinal: number;
  createdAt: string;
  actor: string;
  summary: string;
  paths: string[];
  stats: UnifiedDiffStats;
  fileSummaries: UnifiedDiffFileSummary[];
  hasPatchText: boolean;
  patch?: string;
};

export type SessionVerificationPreset = "handoff";

export type SessionVerificationOptions = {
  preset?: SessionVerificationPreset;
  requireChange?: boolean;
  requirePatch?: boolean;
  requireRecovery?: boolean;
  requireTimeout?: boolean;
  requireDiffStat?: boolean;
  requireReviewProfile?: boolean;
  requireModelCall?: boolean;
  requireNoPendingApprovals?: boolean;
  requiredExecutionProfiles?: CommandExecutionProfileName[];
  requiredApprovalActions?: PolicyAction[];
  requireCommand?: boolean;
};

export type SessionVerificationCheck = {
  id: string;
  label: string;
  status: "pass" | "fail";
  summary: string;
};

export type SessionBundleOptions = SessionVerificationOptions & {
  limit?: number;
};

export async function buildSessionReportView(store: AgentStore, sessionId: string) {
  const session = await store.getSession(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  const messages = await store.getMessages(sessionId);
  const toolResults = await store.getToolResults(sessionId);
  const fileChanges = await store.listFileChanges(sessionId);
  const auditEvents = await store.listAuditEvents({ sessionId, limit: 100 });
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
  const executionProfiles = commandExecutionProfileCounts(finishedCommands);
  const failedToolResults = toolResults.filter((result) => !result.ok);
  const changedPaths = [...new Set(fileChanges.map((change) => change.path))].sort();
  const patchDiffs = sessionPatchAuditEvents(auditEvents).map((event, index) => {
    const patch = auditPatchInput(event.metadata);
    return {
      ordinal: index + 1,
      patch,
      stats: summarizeUnifiedDiffPatch(patch),
    };
  });
  const fileChangeDiffs = patchDiffs.length === 0 ? summarizeFileChangeDiffs(fileChanges, patchDiffs.length + 1) : [];
  const diffSources = [...patchDiffs, ...fileChangeDiffs];
  const diffStats = mergeDiffStats(diffSources.map((patch) => patch.stats));
  const fileSummaries = summarizeDiffFileSummaries(diffSources);
  const reviewProfile = buildDiffReviewProfile({ patches: patchDiffs.length, diffStats, fileSummaries });
  const inspectionPlan = buildDiffInspectionPlan(sessionId, { reviewProfile, fileSummaries });
  const pendingApprovals = approvals.filter((approval) => approval.status === "pending");
  const approvedApprovals = approvals.filter((approval) => approval.status === "approved");
  const deniedApprovals = approvals.filter((approval) => approval.status === "denied");
  const runtimeStopEvents = auditEvents.filter(isRuntimeStoppedAuditEvent).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const lastRuntimeStop = runtimeStopEvents.at(-1);

  return {
    kind: "session_report" as const,
    generatedAt: new Date().toISOString(),
    session,
    summary: {
      messages: messages.length,
      toolResults: toolResults.length,
      failedToolResults: failedToolResults.length,
      fileChanges: fileChanges.length,
      changedPaths,
      commandEvents: commandEvents.length,
      commandsFinished: finishedCommands.length,
      failedCommands: failedCommands.length,
      timedOutCommands: timedOutCommands.length,
      executionProfiles,
      diffStats,
      fileSummaries,
      reviewProfile,
      inspectionPlan,
      approvals: approvals.length,
      pendingApprovals: pendingApprovals.length,
      approvedApprovals: approvedApprovals.length,
      deniedApprovals: deniedApprovals.length,
      modelCalls: modelUsage.totals.calls,
      modelSuccessfulCalls: modelUsage.totals.successfulCalls,
      modelFailedCalls: modelUsage.totals.failedCalls,
      modelCallsWithUsage: modelUsage.totals.callsWithUsage,
      modelPromptTokens: modelUsage.totals.promptTokens,
      modelCompletionTokens: modelUsage.totals.completionTokens,
      modelTotalTokens: modelUsage.totals.totalTokens,
      modelDurationMs: modelUsage.totals.durationMs,
      runtimeStops: runtimeStopEvents.length,
      lastRuntimeStopKind: runtimeStopKind(lastRuntimeStop?.metadata),
      lastRuntimeStopReason: runtimeStopReason(lastRuntimeStop?.metadata),
      resumeCommand: runtimeStopResumeCommand(lastRuntimeStop?.metadata),
      auditEvents: auditEvents.length,
    },
    modelUsage,
    approvals: approvals.map((approval) => ({
      id: approval.id,
      status: approval.status,
      action: approval.action,
      toolName: approval.toolName,
      approverHint: approval.approverHint,
      reason: approval.reason,
      createdAt: approval.createdAt,
      decidedAt: approval.decidedAt,
    })),
    fileChanges,
    commandEvents: commandEvents.map((event) => ({
      type: event.type,
      createdAt: event.createdAt,
      summary: event.summary,
      command: commandText(event.metadata),
      exitCode: commandExitCode(event.metadata),
      timedOut: commandTimedOut(event.metadata),
      durationMs: commandDurationMs(event.metadata),
      executionProfile: commandExecutionProfileName(event.metadata),
      stdoutBytes: commandByteCount(event.metadata, "stdoutBytes"),
      stderrBytes: commandByteCount(event.metadata, "stderrBytes"),
    })),
    toolResults: toolResults.map((result) => ({
      callId: result.callId,
      ok: result.ok,
      error: result.error,
      outputExcerpt: toolOutputExcerpt(result.output),
      truncated: result.truncated,
    })),
    recentAuditEvents: auditEvents.slice(0, 20).map((event) => ({
      type: event.type,
      actor: event.actor,
      summary: event.summary,
      createdAt: event.createdAt,
    })),
    reviewCommands: {
      report: `agent session report ${sessionId} --json`,
      diff: `agent session diff ${sessionId}`,
      status: `agent session status ${sessionId}`,
      review: `agent session review ${sessionId}`,
      result: `agent session result ${sessionId}`,
      inspect: `agent session inspect ${sessionId}`,
      next: `agent session next ${sessionId}`,
      timeline: `agent session timeline ${sessionId}`,
      verify: `agent session verify ${sessionId}`,
      bundle: `agent session bundle ${sessionId} --json`,
      audit: `agent audit list --session ${sessionId}`,
    },
  };
}

export async function buildSessionInspectView(store: AgentStore, sessionId: string) {
  const result = await buildSessionInspectionSnapshot(store, sessionId);
  const handoff = buildSessionHandoffSummary(sessionId, {
    outcome: result.summary.outcome,
    sessionStatus: result.summary.status,
    inspection: result.inspection,
    nextActions: result.nextActions,
  });
  return {
    generatedAt: new Date().toISOString(),
    session: result.session,
    summary: {
      outcome: result.summary.outcome,
      status: result.summary.status,
      targetMode: result.summary.targetMode,
      recovered: result.summary.recovered,
      changedPaths: result.summary.changedPaths,
      patches: result.summary.patches,
      commandsFinished: result.summary.commandsFinished,
      handoffState: handoff.state,
      handoffRequiredIssues: handoff.requiredIssues,
      handoffWarningIssues: handoff.warningIssues,
      handoffRequiredActions: handoff.requiredActions,
      handoffRecommendedActions: handoff.recommendedActions,
      handoffNextCommand: handoff.nextCommand,
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
    handoff,
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

export async function buildSessionResultView(store: AgentStore, sessionId: string) {
  const result = await buildSessionInspectionSnapshot(store, sessionId);
  const handoff = buildSessionHandoffSummary(sessionId, {
    outcome: result.summary.outcome,
    sessionStatus: result.summary.status,
    inspection: result.inspection,
    nextActions: result.nextActions,
  });
  return {
    kind: "session_result" as const,
    generatedAt: new Date().toISOString(),
    session: result.session,
    summary: {
      outcome: result.summary.outcome,
      status: result.summary.status,
      targetMode: result.summary.targetMode,
      recovered: result.summary.recovered,
      changedPaths: result.summary.changedPaths,
      fileChanges: result.summary.fileChanges,
      patches: result.summary.patches,
      commandsFinished: result.summary.commandsFinished,
      failedCommands: result.summary.failedCommands,
      timedOutCommands: result.summary.timedOutCommands,
      pendingApprovals: result.summary.pendingApprovals,
      failedToolResults: result.summary.failedToolResults,
      modelCalls: result.summary.modelCalls,
      modelFailedCalls: result.summary.modelFailedCalls,
      reviewProfile: result.summary.reviewProfile,
      lastCommand: result.summary.lastCommand,
      inspectionState: result.inspection.state,
      inspectionSummary: result.inspection.summary,
      inspectionIssues: result.inspection.issues.length,
      inspectionIssueSeverities: countInspectionSeverities(result.inspection.issues),
      inspectionFocusPaths: result.inspection.focusPaths,
      handoffState: handoff.state,
      handoffRequiredIssues: handoff.requiredIssues,
      handoffWarningIssues: handoff.warningIssues,
      handoffRequiredActions: handoff.requiredActions,
      handoffRecommendedActions: handoff.recommendedActions,
      handoffNextCommand: handoff.nextCommand,
      nextActions: result.nextActions.length,
      nextActionStatuses: result.summary.nextActionStatuses,
    },
    recovery: result.recovery,
    commands: result.commands,
    approvals: result.approvals,
    changes: {
      changedPaths: result.summary.changedPaths,
      reviewProfile: result.summary.reviewProfile,
    },
    inspection: result.inspection,
    handoff,
    nextActions: result.nextActions,
    reviewCommands: {
      result: `agent session result ${sessionId}`,
      status: `agent session status ${sessionId}`,
      review: `agent session review ${sessionId}`,
      inspect: `agent session inspect ${sessionId}`,
      next: `agent session next ${sessionId}`,
      diff: `agent session diff ${sessionId}`,
      timeline: `agent session timeline ${sessionId}`,
      report: `agent session report ${sessionId} --json`,
      verify: `agent session verify ${sessionId}`,
      bundle: `agent session bundle ${sessionId} --json`,
      audit: `agent audit list --session ${sessionId}`,
    },
  };
}

export async function buildSessionVerificationView(store: AgentStore, sessionId: string, options: SessionVerificationOptions = {}) {
  const result = await buildSessionInspectionSnapshot(store, sessionId);
  const effectiveOptions = effectiveSessionVerificationOptions(result, options);
  const checks: SessionVerificationCheck[] = [];
  const requireCommand = effectiveOptions.requireCommand !== false;

  checks.push({
    id: "session-succeeded",
    label: "session succeeded",
    status: result.summary.outcome === "succeeded" ? "pass" : "fail",
    summary: `outcome=${result.summary.outcome}, status=${result.summary.status}`,
  });
  checks.push({
    id: "final-answer-visible",
    label: "final answer visible",
    status: result.summary.finalAnswerState === "empty" ? "fail" : "pass",
    summary: `state=${result.summary.finalAnswerState}, visibleChars=${result.summary.finalAnswerChars}`,
  });
  checks.push({
    id: "tools-clean",
    label: "tools clean",
    status: result.summary.failedToolResults === 0 ? "pass" : "fail",
    summary: `${result.summary.failedToolResults} failed tool result(s) out of ${result.summary.toolResults}`,
  });
  if (requireCommand) {
    const lastCommand = result.summary.lastCommand;
    checks.push({
      id: "command-verified",
      label: "command verified",
      status: result.summary.commandsFinished > 0 && lastCommand?.exitCode === 0 && !lastCommand.timedOut ? "pass" : "fail",
      summary: `commandsFinished=${result.summary.commandsFinished}, lastExit=${lastCommand?.exitCode ?? "-"}, timedOut=${lastCommand?.timedOut ?? false}`,
    });
  }
  if (effectiveOptions.requireChange) {
    checks.push({
      id: "change-evidence",
      label: "change evidence",
      status: result.summary.fileChanges > 0 && result.summary.changedPaths.length > 0 ? "pass" : "fail",
      summary: `${result.summary.fileChanges} file change(s), ${result.summary.changedPaths.length} changed path(s)`,
    });
  }
  if (effectiveOptions.requirePatch) {
    checks.push({
      id: "patch-evidence",
      label: "patch evidence",
      status: result.summary.patches > 0 ? "pass" : "fail",
      summary: `${result.summary.patches} persisted patch(es)`,
    });
  }
  if (effectiveOptions.requireDiffStat) {
    checks.push({
      id: "diff-stat-evidence",
      label: "diff stat evidence",
      status: result.summary.diffStats.files > 0 && (result.summary.diffStats.additions > 0 || result.summary.diffStats.deletions > 0) ? "pass" : "fail",
      summary: formatDiffStatsForVerification(result.summary.diffStats),
    });
  }
  if (effectiveOptions.requireReviewProfile) {
    checks.push({
      id: "review-profile-evidence",
      label: "review profile evidence",
      status: result.summary.reviewProfile.reviewSize !== "none" && result.summary.reviewProfile.files > 0 && Boolean(result.summary.reviewProfile.largestFile) ? "pass" : "fail",
      summary: formatDiffReviewProfileForVerification(result.summary.reviewProfile),
    });
  }
  if (effectiveOptions.requireRecovery) {
    checks.push({
      id: "recovery-evidence",
      label: "recovery evidence",
      status: result.recovery.observedFailure && result.recovery.recovered ? "pass" : "fail",
      summary: `observedFailure=${result.recovery.observedFailure}, recovered=${result.recovery.recovered}`,
    });
  }
  if (effectiveOptions.requireTimeout) {
    checks.push({
      id: "timeout-evidence",
      label: "timeout evidence",
      status: result.summary.timedOutCommands > 0 ? "pass" : "fail",
      summary: `${result.summary.timedOutCommands} timed-out command(s)`,
    });
  }
  if (effectiveOptions.requireModelCall) {
    checks.push({
      id: "model-call-evidence",
      label: "model call evidence",
      status: result.summary.modelSuccessfulCalls > 0 ? "pass" : "fail",
      summary:
        `modelCalls=${result.summary.modelCalls}, successful=${result.summary.modelSuccessfulCalls}, ` +
        `failed=${result.summary.modelFailedCalls}, withUsage=${result.summary.modelCallsWithUsage}, totalTokens=${result.summary.modelTotalTokens}`,
    });
  }
  if (effectiveOptions.requireNoPendingApprovals) {
    checks.push({
      id: "no-pending-approvals",
      label: "no pending approvals",
      status: result.summary.pendingApprovals === 0 ? "pass" : "fail",
      summary: `${result.summary.pendingApprovals} pending approval request(s)`,
    });
  }
  for (const profile of [...new Set(effectiveOptions.requiredExecutionProfiles ?? [])]) {
    const count = result.summary.executionProfiles[profile] ?? 0;
    checks.push({
      id: `execution-profile-${profile.replace(/[^a-z0-9]+/gi, "-")}`,
      label: `execution profile ${profile}`,
      status: count > 0 ? "pass" : "fail",
      summary: `${count} finished command(s) recorded with ${profile}`,
    });
  }
  for (const action of [...new Set(effectiveOptions.requiredApprovalActions ?? [])]) {
    const approvals = result.approvals.filter((approval) => approval.action === action);
    checks.push({
      id: `approval-${action.replace(/[^a-z0-9]+/gi, "-")}`,
      label: `approval ${action}`,
      status: approvals.length > 0 ? "pass" : "fail",
      summary: `${approvals.length} approval request(s) for ${action}`,
    });
  }

  const status: "pass" | "fail" = checks.some((check) => check.status === "fail") ? "fail" : "pass";
  return {
    kind: "session_verification" as const,
    generatedAt: new Date().toISOString(),
    session: result.session,
    status,
    options: {
      preset: options.preset,
      requireCommand,
      requireChange: Boolean(effectiveOptions.requireChange),
      requirePatch: Boolean(effectiveOptions.requirePatch),
      requireRecovery: Boolean(effectiveOptions.requireRecovery),
      requireTimeout: Boolean(effectiveOptions.requireTimeout),
      requireDiffStat: Boolean(effectiveOptions.requireDiffStat),
      requireReviewProfile: Boolean(effectiveOptions.requireReviewProfile),
      requireModelCall: Boolean(effectiveOptions.requireModelCall),
      requireNoPendingApprovals: Boolean(effectiveOptions.requireNoPendingApprovals),
      requiredExecutionProfiles: [...new Set(effectiveOptions.requiredExecutionProfiles ?? [])],
      requiredApprovalActions: [...new Set(effectiveOptions.requiredApprovalActions ?? [])],
    },
    summary: {
      outcome: result.summary.outcome,
      status: result.summary.status,
      targetMode: result.summary.targetMode,
      recovered: result.summary.recovered,
      changedPaths: result.summary.changedPaths,
      fileChanges: result.summary.fileChanges,
      patches: result.summary.patches,
      commandsFinished: result.summary.commandsFinished,
      failedCommands: result.summary.failedCommands,
      timedOutCommands: result.summary.timedOutCommands,
      executionProfiles: result.summary.executionProfiles,
      toolResults: result.summary.toolResults,
      pendingApprovals: result.summary.pendingApprovals,
      failedToolResults: result.summary.failedToolResults,
      diffStats: result.summary.diffStats,
      reviewProfile: result.summary.reviewProfile,
      modelCalls: result.summary.modelCalls,
      modelSuccessfulCalls: result.summary.modelSuccessfulCalls,
      modelFailedCalls: result.summary.modelFailedCalls,
      modelCallsWithUsage: result.summary.modelCallsWithUsage,
      modelTotalTokens: result.summary.modelTotalTokens,
      lastCommand: result.summary.lastCommand,
    },
    checks,
    recovery: result.recovery,
    reviewCommands: {
      verify: `agent session verify ${sessionId}`,
      review: `agent session review ${sessionId}`,
      inspect: `agent session inspect ${sessionId}`,
      diff: `agent session diff ${sessionId}`,
      status: `agent session status ${sessionId}`,
      timeline: `agent session timeline ${sessionId}`,
      report: `agent session report ${sessionId} --json`,
      bundle: `agent session bundle ${sessionId} --json`,
      audit: `agent audit list --session ${sessionId}`,
    },
  };
}

export async function buildSessionBundleView(store: AgentStore, sessionId: string, options: SessionBundleOptions = {}) {
  const diff = await buildSessionDiffView(store, sessionId);
  const report = await buildSessionReportView(store, sessionId);
  const status = await buildSessionStatusView(store, sessionId, { limit: options.limit ?? 8 });
  const timeline = await buildSessionTimelineView(store, sessionId, { limit: options.limit ?? 25 });
  const review = await buildSessionReviewView(store, sessionId, { limit: options.limit ?? 12 });
  const result = await buildSessionResultView(store, sessionId);
  const verification = await buildSessionVerificationView(store, sessionId, options);
  const sections = {
    diff,
    report,
    status,
    timeline,
    review,
    result,
    verification,
  };

  return {
    kind: "session_bundle" as const,
    generatedAt: new Date().toISOString(),
    session: result.session,
    summary: {
      outcome: result.summary.outcome,
      status: result.summary.status,
      targetMode: result.summary.targetMode,
      reviewState: review.summary.reviewState,
      verificationStatus: verification.status,
      sections: Object.keys(sections).sort(),
      changedPaths: result.summary.changedPaths,
      fileChanges: result.summary.fileChanges,
      patches: result.summary.patches,
      diffStats: report.summary.diffStats,
      fileSummaries: report.summary.fileSummaries,
      reviewProfile: report.summary.reviewProfile,
      inspectionPlan: report.summary.inspectionPlan,
      commandsFinished: report.summary.commandsFinished,
      failedCommands: report.summary.failedCommands,
      timedOutCommands: report.summary.timedOutCommands,
      executionProfiles: report.summary.executionProfiles,
      approvals: report.summary.approvals,
      pendingApprovals: result.summary.pendingApprovals,
      toolResults: report.summary.toolResults,
      failedToolResults: result.summary.failedToolResults,
      modelCalls: result.summary.modelCalls,
      modelSuccessfulCalls: report.summary.modelSuccessfulCalls,
      modelFailedCalls: result.summary.modelFailedCalls,
      modelCallsWithUsage: report.summary.modelCallsWithUsage,
      modelPromptTokens: report.summary.modelPromptTokens,
      modelCompletionTokens: report.summary.modelCompletionTokens,
      modelTotalTokens: report.summary.modelTotalTokens,
      modelDurationMs: report.summary.modelDurationMs,
      timelineItems: timeline.summary.totalItems,
      returnedTimelineItems: timeline.summary.returnedItems,
      inspectionState: result.inspection.state,
      inspectionIssues: result.inspection.issues.length,
      inspectionIssueSeverities: result.summary.inspectionIssueSeverities,
      inspectionFocusPaths: result.inspection.focusPaths,
      handoffState: result.handoff.state,
      handoffRequiredIssues: result.handoff.requiredIssues,
      handoffWarningIssues: result.handoff.warningIssues,
      handoffRequiredActions: result.handoff.requiredActions,
      handoffRecommendedActions: result.handoff.recommendedActions,
      handoffNextCommand: result.handoff.nextCommand,
      nextActions: result.nextActions.length,
      nextActionStatuses: countNextActionStatuses(result.nextActions),
    },
    sections,
    reviewCommands: {
      bundle: `agent session bundle ${sessionId} --json`,
      diff: `agent session diff ${sessionId}`,
      inspect: `agent session inspect ${sessionId}`,
      report: `agent session report ${sessionId} --json`,
      status: `agent session status ${sessionId}`,
      timeline: `agent session timeline ${sessionId}`,
      review: `agent session review ${sessionId}`,
      result: `agent session result ${sessionId}`,
      verify: `agent session verify ${sessionId}`,
      audit: `agent audit list --session ${sessionId}`,
    },
  };
}

export async function buildSessionDiffView(store: AgentStore, sessionId: string) {
  const session = await store.getSession(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  const auditEvents = await store.listAuditEvents({ sessionId, limit: 500 });
  const fileChanges = await store.listFileChanges(sessionId);
  const patches = sessionPatchAuditEvents(auditEvents).map((event, index): SessionPatchSummary => {
    const patch = auditPatchInput(event.metadata);
    const stats = summarizeUnifiedDiffPatch(patch);
    return {
      ordinal: index + 1,
      createdAt: event.createdAt,
      actor: actorRefLabel(event.actor),
      summary: event.summary,
      paths: patch ? extractUnifiedDiffPaths(patch) : [],
      stats,
      fileSummaries: summarizeDiffFileSummaries([{ ordinal: index + 1, patch, stats }]),
      hasPatchText: Boolean(patch),
      patch,
    };
  });
  const fileChangeDiffs = patches.length === 0 ? summarizeFileChangeDiffs(fileChanges, patches.length + 1) : [];
  const diffSources = [...patches, ...fileChangeDiffs];
  const diffStats = mergeDiffStats(diffSources.map((patch) => patch.stats));
  const fileSummaries = summarizeDiffFileSummaries(diffSources);
  const reviewProfile = buildDiffReviewProfile({ patches: patches.length, diffStats, fileSummaries });
  const inspectionPlan = buildDiffInspectionPlan(sessionId, { reviewProfile, fileSummaries });
  const changedPaths = [...new Set(fileChanges.map((change) => change.path))].sort();
  return {
    kind: "session_diff" as const,
    generatedAt: new Date().toISOString(),
    session,
    summary: {
      status: session.status,
      targetMode: session.targetMode,
      patches: patches.length,
      fileChanges: fileChanges.length,
      changedPaths,
      diffStats,
      fileSummaries,
      reviewProfile,
      inspectionPlan,
    },
    patches,
    fileChanges: fileChanges.map((change) => ({
      id: change.id,
      kind: change.kind,
      path: change.path,
      summary: change.summary,
      createdAt: change.createdAt,
    })),
    reviewCommands: {
      diff: `agent session diff ${sessionId}`,
      status: `agent session status ${sessionId}`,
      review: `agent session review ${sessionId}`,
      result: `agent session result ${sessionId}`,
      inspect: `agent session inspect ${sessionId}`,
      next: `agent session next ${sessionId}`,
      timeline: `agent session timeline ${sessionId}`,
      report: `agent session report ${sessionId} --json`,
      verify: `agent session verify ${sessionId}`,
      bundle: `agent session bundle ${sessionId} --json`,
      audit: `agent audit list --session ${sessionId}`,
    },
  };
}

export async function buildSessionNextView(store: AgentStore, sessionId: string) {
  const result = await buildSessionInspectionSnapshot(store, sessionId);
  const handoff = buildSessionHandoffSummary(sessionId, {
    outcome: result.summary.outcome,
    sessionStatus: result.summary.status,
    inspection: result.inspection,
    nextActions: result.nextActions,
  });
  return {
    generatedAt: new Date().toISOString(),
    session: result.session,
    summary: {
      outcome: result.summary.outcome,
      status: result.summary.status,
      targetMode: result.summary.targetMode,
      changedPaths: result.summary.changedPaths,
      patches: result.summary.patches,
      commandsFinished: result.summary.commandsFinished,
      pendingApprovals: result.summary.pendingApprovals,
      failedCommands: result.summary.failedCommands,
      timedOutCommands: result.summary.timedOutCommands,
      failedToolResults: result.summary.failedToolResults,
      modelFailedCalls: result.summary.modelFailedCalls,
      handoffState: handoff.state,
      handoffRequiredIssues: handoff.requiredIssues,
      handoffWarningIssues: handoff.warningIssues,
      handoffRequiredActions: handoff.requiredActions,
      handoffRecommendedActions: handoff.recommendedActions,
      handoffNextCommand: handoff.nextCommand,
      inspectionState: result.inspection.state,
      inspectionIssues: result.inspection.issues.length,
      inspectionIssueSeverities: countInspectionSeverities(result.inspection.issues),
      inspectionFocusPaths: result.inspection.focusPaths,
      nextActions: result.nextActions.length,
      nextActionStatuses: result.summary.nextActionStatuses,
    },
    handoff,
    inspection: result.inspection,
    nextActions: result.nextActions,
    reviewCommands: {
      review: `agent session review ${sessionId}`,
      status: `agent session status ${sessionId}`,
      inspect: `agent session inspect ${sessionId}`,
      timeline: `agent session timeline ${sessionId}`,
      result: `agent session result ${sessionId}`,
      verify: `agent session verify ${sessionId}`,
      bundle: `agent session bundle ${sessionId} --json`,
    },
  };
}

export async function buildSessionStatusView(store: AgentStore, sessionId: string, options: { limit?: number } = {}) {
  const result = await buildSessionInspectionSnapshot(store, sessionId);
  const timeline = await buildSessionTimelineView(store, sessionId, { limit: options.limit ?? 8 });
  const handoff = buildSessionHandoffSummary(sessionId, {
    outcome: result.summary.outcome,
    sessionStatus: result.summary.status,
    inspection: result.inspection,
    nextActions: result.nextActions,
  });
  return {
    kind: "session_status" as const,
    generatedAt: new Date().toISOString(),
    session: result.session,
    summary: {
      outcome: result.summary.outcome,
      status: result.summary.status,
      targetMode: result.summary.targetMode,
      recovered: result.summary.recovered,
      changedPaths: result.summary.changedPaths,
      fileChanges: result.summary.fileChanges,
      patches: result.summary.patches,
      commandsFinished: result.summary.commandsFinished,
      failedCommands: result.summary.failedCommands,
      timedOutCommands: result.summary.timedOutCommands,
      pendingApprovals: result.summary.pendingApprovals,
      failedToolResults: result.summary.failedToolResults,
      modelCalls: result.summary.modelCalls,
      modelFailedCalls: result.summary.modelFailedCalls,
      reviewProfile: result.summary.reviewProfile,
      timelineItems: timeline.summary.totalItems,
      returnedTimelineItems: timeline.summary.returnedItems,
      latestAt: timeline.summary.latestAt,
      inspectionState: result.inspection.state,
      inspectionSummary: result.inspection.summary,
      inspectionIssues: result.inspection.issues.length,
      inspectionIssueSeverities: countInspectionSeverities(result.inspection.issues),
      inspectionFocusPaths: result.inspection.focusPaths,
      handoffState: handoff.state,
      handoffRequiredIssues: handoff.requiredIssues,
      handoffWarningIssues: handoff.warningIssues,
      handoffRequiredActions: handoff.requiredActions,
      handoffRecommendedActions: handoff.recommendedActions,
      handoffNextCommand: handoff.nextCommand,
      nextActions: result.nextActions.length,
      nextActionStatuses: result.summary.nextActionStatuses,
    },
    inspection: result.inspection,
    handoff,
    nextActions: result.nextActions,
    latestTimeline: timeline.items,
    reviewCommands: {
      status: `agent session status ${sessionId}`,
      review: `agent session review ${sessionId}`,
      inspect: `agent session inspect ${sessionId}`,
      next: `agent session next ${sessionId}`,
      timeline: `agent session timeline ${sessionId}`,
      result: `agent session result ${sessionId}`,
      report: `agent session report ${sessionId} --json`,
      verify: `agent session verify ${sessionId}`,
      bundle: `agent session bundle ${sessionId} --json`,
    },
  };
}

export async function buildSessionReviewView(store: AgentStore, sessionId: string, options: { limit?: number } = {}) {
  const result = await buildSessionInspectionSnapshot(store, sessionId);
  const timeline = await buildSessionTimelineView(store, sessionId, { limit: options.limit ?? 12 });
  const handoff = buildSessionHandoffSummary(sessionId, {
    outcome: result.summary.outcome,
    sessionStatus: result.summary.status,
    inspection: result.inspection,
    nextActions: result.nextActions,
  });
  const checklist = buildSessionReviewChecklist(sessionId, result);
  const reviewState = sessionReviewState(result.summary.outcome, result.summary.pendingApprovals, checklist);
  return {
    generatedAt: new Date().toISOString(),
    session: result.session,
    summary: {
      reviewState,
      outcome: result.summary.outcome,
      status: result.summary.status,
      targetMode: result.summary.targetMode,
      recovered: result.summary.recovered,
      changedPaths: result.summary.changedPaths,
      fileChanges: result.summary.fileChanges,
      patches: result.summary.patches,
      commandsFinished: result.summary.commandsFinished,
      failedCommands: result.summary.failedCommands,
      timedOutCommands: result.summary.timedOutCommands,
      failedToolResults: result.summary.failedToolResults,
      pendingApprovals: result.summary.pendingApprovals,
      modelCalls: result.summary.modelCalls,
      modelFailedCalls: result.summary.modelFailedCalls,
      reviewProfile: result.summary.reviewProfile,
      checklistStatuses: countReviewChecklistStatuses(checklist),
      timelineItems: timeline.summary.totalItems,
      returnedTimelineItems: timeline.summary.returnedItems,
      inspectionState: result.inspection.state,
      inspectionIssues: result.inspection.issues.length,
      inspectionIssueSeverities: countInspectionSeverities(result.inspection.issues),
      inspectionFocusPaths: result.inspection.focusPaths,
      handoffState: handoff.state,
      handoffRequiredIssues: handoff.requiredIssues,
      handoffWarningIssues: handoff.warningIssues,
      handoffRequiredActions: handoff.requiredActions,
      handoffRecommendedActions: handoff.recommendedActions,
      handoffNextCommand: handoff.nextCommand,
      nextActions: result.nextActions.length,
      nextActionStatuses: result.summary.nextActionStatuses,
    },
    checklist,
    changes: {
      changedPaths: result.summary.changedPaths,
      reviewProfile: result.summary.reviewProfile,
    },
    inspection: result.inspection,
    handoff,
    nextActions: result.nextActions,
    latestTimeline: timeline.items,
    timeline: {
      summary: timeline.summary,
    },
    reviewCommands: {
      diff: `agent session diff ${sessionId}`,
      status: `agent session status ${sessionId}`,
      inspect: `agent session inspect ${sessionId}`,
      timeline: `agent session timeline ${sessionId}`,
      review: `agent session review ${sessionId}`,
      result: `agent session result ${sessionId}`,
      report: `agent session report ${sessionId} --json`,
      verify: `agent session verify ${sessionId}`,
      bundle: `agent session bundle ${sessionId} --json`,
      audit: `agent audit list --session ${sessionId}`,
    },
  };
}

export async function buildSessionDashboardView(store: AgentStore, options: SessionDashboardOptions = {}) {
  const limit = options.limit ?? 20;
  const scanLimit = options.status || options.targetMode ? Math.max(limit * 5, 50) : limit;
  const scanned = await store.listSessions(scanLimit);
  const filtered = scanned
    .filter((session) => !options.status || session.status === options.status)
    .filter((session) => !options.targetMode || session.targetMode === options.targetMode)
    .slice(0, limit);
  const sessions = [];
  for (const session of filtered) {
    const result = await buildSessionInspectionSnapshot(store, session.id);
    const handoff = buildSessionHandoffSummary(session.id, {
      outcome: result.summary.outcome,
      sessionStatus: result.summary.status,
      inspection: result.inspection,
      nextActions: result.nextActions,
    });
    sessions.push({
      session: result.session,
      summary: {
        outcome: result.summary.outcome,
        status: result.summary.status,
        targetMode: result.summary.targetMode,
        recovered: result.summary.recovered,
        pendingApprovals: result.summary.pendingApprovals,
        changedPaths: result.summary.changedPaths,
        patches: result.summary.patches,
        commandsFinished: result.summary.commandsFinished,
        failedCommands: result.summary.failedCommands,
        timedOutCommands: result.summary.timedOutCommands,
        failedToolResults: result.summary.failedToolResults,
        modelCalls: result.summary.modelCalls,
        modelFailedCalls: result.summary.modelFailedCalls,
        inspectionState: result.inspection.state,
        inspectionIssues: result.inspection.issues.length,
        inspectionIssueSeverities: countInspectionSeverities(result.inspection.issues),
        inspectionFocusPaths: result.inspection.focusPaths,
        handoffState: handoff.state,
        handoffRequiredIssues: handoff.requiredIssues,
        handoffWarningIssues: handoff.warningIssues,
        handoffRequiredActions: handoff.requiredActions,
        handoffRecommendedActions: handoff.recommendedActions,
        handoffNextCommand: handoff.nextCommand,
        nextActions: result.nextActions.length,
        nextActionStatuses: result.summary.nextActionStatuses,
      },
      handoff,
      nextActions: result.nextActions,
      reviewCommands: {
        status: `agent session status ${session.id}`,
        inspect: `agent session inspect ${session.id}`,
        next: `agent session next ${session.id}`,
        review: `agent session review ${session.id}`,
        result: `agent session result ${session.id}`,
        timeline: `agent session timeline ${session.id}`,
        verify: `agent session verify ${session.id}`,
        bundle: `agent session bundle ${session.id} --json`,
      },
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      scanned: scanned.length,
      returned: sessions.length,
      limit,
      filters: {
        status: options.status,
        targetMode: options.targetMode,
      },
      byStatus: countDashboardBy(sessions, (entry) => entry.session.status),
      byOutcome: countDashboardBy(sessions, (entry) => entry.summary.outcome),
      byHandoffState: countDashboardBy(sessions, (entry) => entry.summary.handoffState),
      pendingApprovals: sessions.reduce((total, entry) => total + entry.summary.pendingApprovals, 0),
      changedSessions: sessions.filter((entry) => entry.summary.changedPaths.length > 0).length,
      requiredHandoffs: sessions.filter((entry) => entry.summary.handoffRequiredActions > 0).length,
    },
    sessions,
  };
}

async function buildSessionInspectionSnapshot(store: AgentStore, sessionId: string): Promise<SessionInspectionSnapshot> {
  const session = await store.getSession(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const toolResults = await store.getToolResults(sessionId);
  const messages = await store.getMessages(sessionId);
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
  const executionProfiles = commandExecutionProfileCounts(finishedCommands);
  const firstFailedIndex = finishedCommands.findIndex((event) =>
    commandTimedOut(event.metadata) ||
    (commandExitCode(event.metadata) !== undefined && commandExitCode(event.metadata) !== 0)
  );
  const recoveryCommand = firstFailedIndex >= 0
    ? finishedCommands.slice(firstFailedIndex + 1).find((event) => commandExitCode(event.metadata) === 0 && !commandTimedOut(event.metadata))
    : undefined;
  const lastCommand = finishedCommands.at(-1);
  const commandSummaries = finishedCommands.map((event, index) => sessionCommandSummaryFromAuditEvent(event, index + 1));
  const recoveryCommandIndex = recoveryCommand ? finishedCommands.indexOf(recoveryCommand) : -1;
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
  const fileChangeDiffs = patchDiffs.length === 0 ? summarizeFileChangeDiffs(fileChanges, patchDiffs.length + 1) : [];
  const diffSources = [...patchDiffs, ...fileChangeDiffs];
  const diffStats = mergeDiffStats(diffSources.map((patch) => patch.stats));
  const fileSummaries = summarizeDiffFileSummaries(diffSources);
  const reviewProfile = buildDiffReviewProfile({ patches: patchDiffs.length, diffStats, fileSummaries });
  const pendingApprovalIds = approvals.filter((approval) => approval.status === "pending").map((approval) => approval.id);
  const failedToolResults = toolResults.filter((result) => !result.ok);
  const finalAssistantMessage = messages
    .filter((message) => message.role === "assistant" && !message.toolCalls?.length)
    .at(-1);
  const finalAnswerChars = finalAssistantMessage?.content.trim().length ?? 0;
  const finalAnswerState = finalAssistantMessage ? finalAnswerChars > 0 ? "visible" : "empty" : "missing";
  const runtimeStopEvents = auditEvents.filter(isRuntimeStoppedAuditEvent).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const lastRuntimeStop = runtimeStopEvents.at(-1);
  const nextActions = buildSessionNextActions(sessionId, {
    outcome,
    sessionStatus: session.status,
    pendingApprovalIds,
    changedPaths,
    patches: patchDiffs.length,
    diffFiles: diffStats.files,
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
      changedPaths,
      fileChanges: fileChanges.length,
      patches: patchDiffs.length,
      commandsFinished: finishedCommands.length,
      failedCommands: failedCommands.length,
      timedOutCommands: timedOutCommands.length,
      toolResults: toolResults.length,
      failedToolResults: failedToolResults.length,
      executionProfiles,
      diffStats,
      fileSummaries,
      modelFailedCalls: modelUsage.totals.failedCalls,
      modelCalls: modelUsage.totals.calls,
      modelSuccessfulCalls: modelUsage.totals.successfulCalls,
      modelCallsWithUsage: modelUsage.totals.callsWithUsage,
      modelTotalTokens: modelUsage.totals.totalTokens,
      finalAnswerChars,
      finalAnswerState,
      runtimeStops: runtimeStopEvents.length,
      lastRuntimeStopKind: runtimeStopKind(lastRuntimeStop?.metadata),
      lastRuntimeStopReason: runtimeStopReason(lastRuntimeStop?.metadata),
      resumeCommand: runtimeStopResumeCommand(lastRuntimeStop?.metadata),
      reviewProfile,
      nextActionStatuses: countNextActionStatuses(nextActions),
      lastCommand: commandSummaries.at(-1),
    },
    inspection,
    nextActions,
    commands: commandSummaries,
    recovery: {
      observedFailure: failedCommands.length > 0,
      recovered: Boolean(recoveryCommand),
      firstFailedCommand: firstFailedIndex >= 0 ? commandSummaries[firstFailedIndex] : undefined,
      recoveryCommand: recoveryCommandIndex >= 0 ? commandSummaries[recoveryCommandIndex] : undefined,
    },
    approvals: approvals.map((approval) => ({
      id: approval.id,
      status: approval.status,
      action: approval.action,
      toolName: approval.toolName,
      reason: approval.reason,
      createdAt: approval.createdAt,
      decidedAt: approval.decidedAt,
    })),
  };
}

function buildSessionReviewChecklist(sessionId: string, result: SessionInspectionSnapshot): SessionReviewChecklistItem[] {
  return [
    {
      id: "change-summary",
      label: "change summary",
      status: result.summary.changedPaths.length > 0 || result.summary.fileChanges > 0 ? "pass" : "warn",
      summary: `${result.summary.changedPaths.length} changed path(s), ${result.summary.fileChanges} file change record(s)`,
      command: `agent session diff ${sessionId}`,
    },
    {
      id: "patch-review",
      label: "patch review",
      status: result.summary.patches > 0 ? "pass" : "warn",
      summary: `${result.summary.patches} persisted patch(es)`,
      command: `agent session diff ${sessionId}`,
    },
    {
      id: "command-result",
      label: "command result",
      status: result.summary.commandsFinished === 0
        ? "warn"
        : result.summary.failedCommands === 0 && result.summary.timedOutCommands === 0
          ? "pass"
          : "fail",
      summary: `commands=${result.summary.commandsFinished}, failed=${result.summary.failedCommands}, timedOut=${result.summary.timedOutCommands}`,
      command: `agent session report ${sessionId} --json`,
    },
    {
      id: "approval-state",
      label: "approval state",
      status: result.summary.pendingApprovals > 0 ? "warn" : "pass",
      summary: `${result.summary.pendingApprovals} pending approval request(s)`,
      command: result.summary.pendingApprovals > 0 ? "agent approvals pending" : undefined,
    },
    {
      id: "tool-errors",
      label: "tool errors",
      status: result.summary.failedToolResults === 0 ? "pass" : "fail",
      summary: `${result.summary.failedToolResults} failed tool result(s)`,
      command: `agent session timeline ${sessionId}`,
    },
    {
      id: "handoff-state",
      label: "handoff state",
      status: result.inspection.state === "blocked" ? "fail" : result.inspection.state === "needs_attention" ? "warn" : "pass",
      summary: result.inspection.summary,
      command: `agent session inspect ${sessionId}`,
    },
  ];
}

function sessionReviewState(
  outcome: string,
  pendingApprovals: number,
  checklist: SessionReviewChecklistItem[],
): "ready" | "needs_attention" | "waiting_for_approval" | "in_progress" {
  if (pendingApprovals > 0) {
    return "waiting_for_approval";
  }
  if (outcome === "in_progress" || outcome === "paused") {
    return "in_progress";
  }
  if (checklist.some((item) => item.status === "fail")) {
    return "needs_attention";
  }
  return "ready";
}

function countReviewChecklistStatuses(checklist: SessionReviewChecklistItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of checklist) {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
  }
  return counts;
}

function buildSessionNextActions(sessionId: string, input: {
  outcome: string;
  sessionStatus: Session["status"];
  pendingApprovalIds: string[];
  changedPaths: string[];
  patches: number;
  diffFiles: number;
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
      reason: `${input.changedPaths.length} changed path(s), ${input.patches} persisted patch(es), and ${input.diffFiles} diff-summary file(s) are available for review.`,
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
  diffFiles: number;
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
    flags.push("--require-patch");
  }
  if (input.diffFiles > 0) {
    flags.push("--require-diff-stat", "--require-review-profile");
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

function effectiveSessionVerificationOptions(
  snapshot: SessionInspectionSnapshot,
  options: SessionVerificationOptions,
): SessionVerificationOptions {
  if (options.preset !== "handoff") {
    return options;
  }
  return {
    ...options,
    requireChange: options.requireChange ?? snapshot.summary.changedPaths.length > 0,
    requirePatch: options.requirePatch ?? snapshot.summary.patches > 0,
    requireDiffStat: options.requireDiffStat ?? snapshot.summary.diffStats.files > 0,
    requireReviewProfile: options.requireReviewProfile ?? snapshot.summary.reviewProfile.files > 0,
    requireRecovery: options.requireRecovery ?? (snapshot.summary.failedCommands > 0 && snapshot.summary.recovered),
    requireTimeout: options.requireTimeout ?? snapshot.summary.timedOutCommands > 0,
    requireModelCall: options.requireModelCall ?? snapshot.summary.modelCalls > 0,
  };
}

function formatDiffStatsForVerification(stats: UnifiedDiffStats): string {
  return `files:${stats.files},+${stats.additions},-${stats.deletions}`;
}

function formatDiffReviewProfileForVerification(profile: UnifiedDiffReviewProfile): string {
  const largest = profile.largestFile
    ? `${profile.largestFile.path}:+${profile.largestFile.additions}/-${profile.largestFile.deletions}`
    : "-";
  return `${profile.reviewSize}:files=${profile.files},+${profile.additions},-${profile.deletions},largest=${largest}`;
}

function buildSessionHandoffSummary(
  sessionId: string,
  input: {
    outcome: string;
    sessionStatus: Session["status"];
    inspection: SessionInspectionSummary;
    nextActions: SessionOperatorNextAction[];
  },
): SessionHandoffSummary {
  const requiredIssues = input.inspection.issues.filter((issue) => issue.severity === "required").length;
  const warningIssues = input.inspection.issues.filter((issue) => issue.severity === "warning").length;
  const requiredActions = input.nextActions.filter((action) => action.status === "required").length;
  const recommendedActions = input.nextActions.filter((action) => action.status === "recommended").length;
  const nextAction =
    input.nextActions.find((action) => action.status === "required") ??
    input.nextActions.find((action) => action.status === "recommended") ??
    input.nextActions.find((action) => action.status === "optional");
  const verificationCommand =
    input.nextActions.find((action) => action.id === "verify-session")?.command ??
    `agent session verify ${sessionId}`;
  const bundleCommand =
    input.nextActions.find((action) => action.id === "export-bundle")?.command ??
    `agent session bundle ${sessionId} --json --output .agent/tmp/session-bundle.json`;
  const inProgress = input.sessionStatus === "created" || input.sessionStatus === "running" || input.outcome === "in_progress";
  const state: SessionHandoffState = inProgress
    ? "in_progress"
    : input.inspection.state === "blocked" || requiredActions > 0
      ? "blocked"
      : input.inspection.state === "needs_attention"
        ? "needs_attention"
        : "ready";
  return {
    state,
    summary: state === "ready"
      ? "Session evidence is ready for handoff."
      : state === "in_progress"
        ? "Session is still in progress; finish or pause it before handoff."
        : state === "blocked"
          ? `${requiredIssues} required issue(s) and ${requiredActions} required action(s) block handoff.`
          : `${warningIssues} warning issue(s) should be reviewed before handoff.`,
    requiredIssues,
    warningIssues,
    requiredActions,
    recommendedActions,
    nextCommand: nextAction?.command,
    reviewCommand: `agent session review ${sessionId}`,
    verificationCommand,
    bundleCommand,
    focusPaths: input.inspection.focusPaths,
  };
}

function countDashboardBy<T>(entries: T[], keyFn: (entry: T) => string | undefined): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    const key = keyFn(entry) ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
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

function actorRefLabel(actor: { type: string; id: string }): string {
  return `${actor.type}:${actor.id}`;
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

function isRuntimeStoppedAuditEvent(event: AuditEvent): boolean {
  return event.type === "agent.event" && event.metadata?.eventType === "runtime_stopped";
}

function runtimeStopKind(metadata: Record<string, unknown> | undefined): string | undefined {
  return typeof metadata?.stopKind === "string" ? metadata.stopKind : undefined;
}

function runtimeStopReason(metadata: Record<string, unknown> | undefined): string | undefined {
  return typeof metadata?.reason === "string" ? metadata.reason : undefined;
}

function runtimeStopResumeCommand(metadata: Record<string, unknown> | undefined): string | undefined {
  return typeof metadata?.resumeCommand === "string" ? metadata.resumeCommand : undefined;
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

function commandText(metadata: Record<string, unknown> | undefined): string | undefined {
  return typeof metadata?.command === "string" ? metadata.command : undefined;
}

function commandDurationMs(metadata: Record<string, unknown> | undefined): number | undefined {
  return typeof metadata?.durationMs === "number" ? metadata.durationMs : undefined;
}

function commandExecutionProfileName(metadata: Record<string, unknown> | undefined): string | undefined {
  return typeof metadata?.executionProfile === "string" ? metadata.executionProfile : undefined;
}

function commandExecutionProfileCounts(events: Array<{ metadata?: Record<string, unknown> }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) {
    const profile = commandExecutionProfileName(event.metadata);
    if (!profile) {
      continue;
    }
    counts[profile] = (counts[profile] ?? 0) + 1;
  }
  return counts;
}

function commandByteCount(metadata: Record<string, unknown> | undefined, key: "stdoutBytes" | "stderrBytes"): number | undefined {
  const value = metadata?.[key];
  return typeof value === "number" ? value : undefined;
}

function toolOutputExcerpt(output?: string): string | undefined {
  if (!output) {
    return undefined;
  }
  return output.length > 1000 ? `${output.slice(0, 1000)}\n[truncated]` : output;
}

function sessionCommandSummaryFromAuditEvent(event: AuditEvent, ordinal: number): SessionCommandSummary {
  const exitCode = commandExitCode(event.metadata);
  const timedOut = commandTimedOut(event.metadata);
  const status: SessionCommandSummary["status"] = timedOut
    ? "timeout"
    : exitCode === 0
      ? "pass"
      : exitCode === undefined || exitCode === null
        ? "unknown"
        : "fail";
  return {
    ordinal,
    status,
    command: commandText(event.metadata),
    exitCode,
    timedOut,
    durationMs: commandDurationMs(event.metadata),
    executionProfile: commandExecutionProfileName(event.metadata),
    createdAt: event.createdAt,
    stdoutBytes: commandByteCount(event.metadata, "stdoutBytes"),
    stderrBytes: commandByteCount(event.metadata, "stderrBytes"),
  };
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

function summarizeFileChangeDiffs(fileChanges: FileChange[], startOrdinal: number): Array<{ ordinal: number; stats: UnifiedDiffStats; changeType?: UnifiedDiffChangeType }> {
  const summaries: Array<{ ordinal: number; stats: UnifiedDiffStats; changeType?: UnifiedDiffChangeType }> = [];
  let ordinal = startOrdinal;
  for (const change of fileChanges.slice().sort((left, right) => left.createdAt.localeCompare(right.createdAt))) {
    const summary = summarizeFileChangeDiff(change, ordinal);
    if (summary) {
      summaries.push(summary);
      ordinal += 1;
    }
  }
  return summaries;
}

function summarizeFileChangeDiff(change: FileChange, ordinal: number): { ordinal: number; stats: UnifiedDiffStats; changeType?: UnifiedDiffChangeType } | undefined {
  if (change.kind === "patch") {
    return undefined;
  }
  const pathStats = fileChangePathStats(change);
  if (!pathStats) {
    return undefined;
  }
  const byPath = new Map<string, UnifiedDiffPathStats>();
  byPath.set(pathStats.path, {
    path: pathStats.path,
    additions: pathStats.additions,
    deletions: pathStats.deletions,
  });
  return {
    ordinal,
    stats: diffStatsFromMap(byPath),
    changeType: pathStats.changeType,
  };
}

function fileChangePathStats(change: FileChange): (UnifiedDiffPathStats & { changeType: UnifiedDiffChangeType }) | undefined {
  if (change.kind === "replace_range") {
    const replacedLines = replacedLineCount(change.summary);
    return { path: change.path, additions: replacedLines, deletions: replacedLines, changeType: "modified" };
  }
  if (change.kind === "create") {
    const isOverwrite = Boolean(change.beforeHash);
    return {
      path: change.path,
      additions: 1,
      deletions: isOverwrite ? 1 : 0,
      changeType: isOverwrite ? "modified" : "added",
    };
  }
  if (change.kind === "delete") {
    return { path: change.path, additions: 0, deletions: 1, changeType: "deleted" };
  }
  if (change.kind === "rename") {
    return { path: change.path, additions: 1, deletions: 1, changeType: "renamed" };
  }
  return undefined;
}

function replacedLineCount(summary: string): number {
  const match = /replaced lines (\d+)-(\d+)/i.exec(summary);
  if (!match) {
    return 1;
  }
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) {
    return 1;
  }
  return Math.max(1, end - start + 1);
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

function buildDiffInspectionPlan(sessionId: string, input: {
  reviewProfile: UnifiedDiffReviewProfile;
  fileSummaries: UnifiedDiffFileSummary[];
}): UnifiedDiffInspectionPlan {
  const items = input.fileSummaries
    .slice()
    .sort(compareDiffInspectionFileSummaries)
    .map((summary, index) => ({
      priority: index + 1,
      path: summary.path,
      additions: summary.additions,
      deletions: summary.deletions,
      changedLines: summary.additions + summary.deletions,
      changeType: summary.changeType,
      patches: summary.patches,
      reviewSize: summary.reviewSize,
      reason: diffInspectionReason(summary),
      command: `agent session diff ${sessionId}`,
    }));
  const focusPaths = items.slice(0, 5).map((item) => item.path);
  const state: UnifiedDiffInspectionPlanState = items.length > 0 ? "ready" : "none";
  return {
    state,
    summary: state === "ready"
      ? `Review ${items.length} changed file(s) in priority order; ${input.reviewProfile.reviewHint}; focus=${focusPaths.join(",") || "-"}`
      : "No persisted patch changes need diff inspection.",
    focusPaths,
    commands: {
      diff: `agent session diff ${sessionId}`,
      review: `agent session review ${sessionId}`,
      result: `agent session result ${sessionId}`,
    },
    items,
  };
}

function compareDiffInspectionFileSummaries(left: UnifiedDiffFileSummary, right: UnifiedDiffFileSummary): number {
  return diffReviewSizeRank(right.reviewSize) - diffReviewSizeRank(left.reviewSize) ||
    (right.additions + right.deletions) - (left.additions + left.deletions) ||
    diffChangeTypeRank(right.changeType) - diffChangeTypeRank(left.changeType) ||
    left.path.localeCompare(right.path);
}

function diffReviewSizeRank(size: UnifiedDiffReviewSize): number {
  return size === "large" ? 3 : size === "medium" ? 2 : 1;
}

function diffChangeTypeRank(changeType: UnifiedDiffChangeType): number {
  switch (changeType) {
    case "deleted":
      return 4;
    case "renamed":
      return 3;
    case "added":
      return 2;
    case "modified":
      return 1;
  }
}

function diffInspectionReason(summary: UnifiedDiffFileSummary): string {
  const size = `${summary.reviewSize} ${summary.changeType} change (+${summary.additions}/-${summary.deletions})`;
  if (summary.changeType === "deleted") {
    return `${size}; confirm the removal and any callers.`;
  }
  if (summary.changeType === "added") {
    return `${size}; confirm integration points and test coverage.`;
  }
  if (summary.changeType === "renamed") {
    return `${size}; confirm references and import paths.`;
  }
  return `${size}; confirm intent, tests, and nearby behavior.`;
}

function summarizeDiffFileSummaries(patches: Array<{ ordinal: number; patch?: string; stats: UnifiedDiffStats; changeType?: UnifiedDiffChangeType }>): UnifiedDiffFileSummary[] {
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
      target.changeTypes.add(changeTypes.get(entry.path) ?? patch.changeType ?? "modified");
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

function extractUnifiedDiffPaths(patch: string): string[] {
  const paths = new Set<string>();
  let oldPath: string | undefined;
  for (const line of patch.replace(/\r\n/g, "\n").split("\n")) {
    if (line.startsWith("--- ")) {
      oldPath = parseUnifiedDiffPath(line, "--- ");
      continue;
    }
    if (line.startsWith("+++ ")) {
      const newPath = parseUnifiedDiffPath(line, "+++ ");
      const target = newPath ?? oldPath;
      if (target) {
        paths.add(target);
      }
      oldPath = undefined;
    }
  }
  return [...paths].sort();
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
