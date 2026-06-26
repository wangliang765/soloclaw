import type { ExecutionTargetMode } from "../domain/index.js";

export type CompletionGateCommandEvent = {
  command?: string;
  exitCode?: number;
};

export type CompletionGateInput = {
  targetMode: ExecutionTargetMode;
  changedFiles: string[];
  commandEvents: CompletionGateCommandEvent[];
  pendingApprovalCount: number;
  failedToolCount: number;
};

export type CompletionGateResult = {
  status: "pass" | "warn" | "block";
  missingEvidence: string[];
  summary: string;
};

export function evaluateCompletionGate(input: CompletionGateInput): CompletionGateResult {
  const missingEvidence: string[] = [];
  if (input.pendingApprovalCount > 0) {
    missingEvidence.push("pending_approvals");
  }
  if (input.failedToolCount > 0) {
    missingEvidence.push("failed_tools");
  }
  if (input.changedFiles.length > 0 && !hasSuccessfulVerificationCommand(input.commandEvents)) {
    missingEvidence.push("verification_command");
  }
  const status = missingEvidence.includes("pending_approvals")
    ? "block"
    : missingEvidence.length > 0
      ? "warn"
      : "pass";
  return {
    status,
    missingEvidence,
    summary: missingEvidence.length === 0
      ? "Completion gate passed."
      : `Completion gate ${status}: ${missingEvidence.join(", ")}`,
  };
}

function hasSuccessfulVerificationCommand(events: CompletionGateCommandEvent[]): boolean {
  return events.some((event) =>
    event.exitCode === 0 &&
    /(\bnpm(?:\.cmd)?\s+(run\s+)?(build|check|test)\b|\bnode\s+--test\b|\bphase\d\b|\bgit\s+diff\s+--check\b)/i.test(event.command ?? ""),
  );
}
