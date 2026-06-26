import { promises as fs } from "node:fs";
import path from "node:path";
import { LocalProviderProfileStore } from "../model/local-provider-profile-store.js";
import { localSecretVaultPassphraseFile } from "../secrets/encrypted-file-secret-store.js";

export type PhaseTwoClosureStatus = {
  status: "pending_manual_evidence";
  phaseClosure: "manual_closeout_required";
  blockers: string[];
  checks: Array<{
    id: string;
    label: string;
    status: "pending" | "waiting_for_C1_C2";
    evidenceRequired: string;
  }>;
  nextCommands: {
    status: string;
    readiness: string;
    launchTerminal: string;
    checklist: string;
    operatorRunbook: string;
    closeoutWizardAll: string;
    closeoutWizard: string;
    evidenceTemplate: string;
    evidenceRecord: string;
    evidenceCheck: string;
    richTuiSmoke: string;
    realProviderRichTuiSmoke: string;
    finalGate: string;
  };
};

export type PhaseTwoReadinessCheckStatus = "pass" | "fail" | "warn" | "skip";

export type PhaseTwoEvidenceCheckStatus =
  | "paste_safe_pending_manual_review"
  | "missing_evidence_file"
  | "missing_evidence_sections"
  | "missing_dated_evidence"
  | "incomplete_closure_tasks"
  | "secret_leak_detected";

export type PhaseTwoRealProviderReadinessCheck = {
  id: string;
  status: PhaseTwoReadinessCheckStatus;
  summary: string;
};

export type PhaseTwoEvidenceCheck = {
  status: PhaseTwoEvidenceCheckStatus;
  file: string;
  strict: boolean;
  secretMatches: number;
  checks: PhaseTwoRealProviderReadinessCheck[];
};

export type PhaseTwoGateSummary = {
  status: "blocked_manual_evidence" | "ready_for_completion" | "secret_leak_detected";
  workspace: string;
  realProviderReadiness: PhaseTwoRealProviderReadiness["status"];
  strictEvidence: PhaseTwoEvidenceCheckStatus;
  blockers: string[];
  nextActions: string[];
  readiness: PhaseTwoRealProviderReadiness;
  evidence: PhaseTwoEvidenceCheck;
};

export type PhaseTwoNextAction = {
  status: PhaseTwoGateSummary["status"];
  workspace: string;
  blocker?: string;
  action: string;
  remainingActions: number;
  realProviderReadiness: PhaseTwoRealProviderReadiness["status"];
  strictEvidence: PhaseTwoEvidenceCheckStatus;
};

export type PhaseTwoReviewItem = {
  section: PhaseTwoEvidenceRecordSection;
  evidence: "recorded" | "missing" | "undated";
  review: "checked" | "needs_review" | "waiting_for_evidence";
  summary: string;
  nextCommand: string;
};

export type PhaseTwoReviewBoard = {
  status: PhaseTwoGateSummary["status"];
  workspace: string;
  realProviderReadiness: PhaseTwoRealProviderReadiness["status"];
  strictEvidence: PhaseTwoEvidenceCheckStatus;
  secretMatches: number;
  items: PhaseTwoReviewItem[];
  nextReviewAction: string;
};

export type PhaseTwoEvidenceRecordSection = "C1" | "C2" | "C3";

export type PhaseTwoEvidenceReview = {
  file: string;
  section: PhaseTwoEvidenceRecordSection;
  status: "ready_for_review" | "missing_dated_evidence";
  secretMatches: number;
  text: string;
  nextCommand: string;
};

export type PhaseTwoEvidenceRecordInput = {
  section: PhaseTwoEvidenceRecordSection;
  filePath?: string;
  date?: string;
  fields?: Record<string, string | undefined>;
};

export type PhaseTwoEvidenceRecordResult = {
  status: "recorded";
  file: string;
  section: PhaseTwoEvidenceRecordSection;
  insertedLines: number;
  secretMatches: number;
};

export type PhaseTwoClosureTaskInput = {
  section: PhaseTwoEvidenceRecordSection;
  filePath?: string;
  confirmReviewed?: boolean;
};

export type PhaseTwoClosureTaskResult = {
  status: "checked" | "already_checked";
  file: string;
  section: PhaseTwoEvidenceRecordSection;
  secretMatches: number;
};

export type PhaseTwoExternalTerminalLaunch = {
  workspace: string;
  method: "powershell-start-process";
  windowTitle: string;
  shellCommand: string;
  terminalCommand: string;
};

export type PhaseTwoExternalTerminalLaunchResult = {
  pid?: number;
};

export const PHASE_TWO_PLAN_RELATIVE_PATH = path.join(
  "docs",
  "superpowers",
  "plans",
  "2026-06-18-soloclaw-rich-tui-event-stream.md",
);

export type PhaseTwoRealProviderReadiness = {
  status: "missing_real_provider" | "missing_api_key_reference" | "missing_secret_storage" | "secret_leak_detected" | "ready_for_manual_run";
  workspace: string;
  activeProvider: string;
  model: string;
  baseUrl: string;
  checks: PhaseTwoRealProviderReadinessCheck[];
  nextCommands: {
    launchTerminal: string;
    setup: string;
    modelCheck: string;
    task: string;
    leakScan: string;
    closeoutWizardAll: string;
    closeoutWizard: string;
    evidenceTemplate: string;
  };
};

export function buildPhaseTwoClosureStatus(): PhaseTwoClosureStatus {
  return {
    status: "pending_manual_evidence",
    phaseClosure: "manual_closeout_required",
    blockers: ["C1", "C2", "C3"],
    checks: [
      {
        id: "C1",
        label: "external terminal rich TUI",
        status: "pending",
        evidenceRequired: "Human-run Windows Terminal or PowerShell session proves rendering, keyboard handling, and cursor restore.",
      },
      {
        id: "C2",
        label: "real-provider setup and task",
        status: "pending",
        evidenceRequired: "A real provider/API key run proves provider -> model -> API key setup, /model check, live progress, final answer, and no key leak.",
      },
      {
        id: "C3",
        label: "final automated gate",
        status: "waiting_for_C1_C2",
        evidenceRequired: "Run check, tests, rich smoke, whitespace check, and temp-file scan after C1 and C2 evidence is recorded.",
      },
    ],
    nextCommands: {
      status: "soloclaw phase2 status",
      readiness: "soloclaw phase2 readiness",
      launchTerminal: "soloclaw phase2 launch-terminal",
      checklist: "soloclaw phase2 checklist",
      operatorRunbook: "soloclaw phase2 operator-runbook",
      closeoutWizardAll: phaseTwoCloseoutWizardAllCommand(),
      closeoutWizard: "soloclaw phase2 closeout-wizard --section C1|C2|C3",
      evidenceTemplate: "soloclaw phase2 evidence-template",
      evidenceRecord: "soloclaw phase2 evidence-record --section C1|C2|C3",
      evidenceCheck: "soloclaw phase2 evidence-check",
      richTuiSmoke: "node dist\\cli\\index.js smoke --rich-tui",
      realProviderRichTuiSmoke: "node dist\\cli\\index.js smoke --rich-tui-real-provider",
      finalGate: "npm.cmd run check; npm.cmd test; node dist\\cli\\index.js smoke --rich-tui; node dist\\cli\\index.js smoke --rich-tui-real-provider; git diff --check",
    },
  };
}

export function renderPhaseTwoClosureStatus(status: PhaseTwoClosureStatus): string {
  const lines = [
    "Phase 2 closure status",
    `status=${status.status}`,
    `phaseClosure=${status.phaseClosure}`,
    `blockers=${status.blockers.join(",")}`,
    "",
    "Checks:",
  ];
  for (const check of status.checks) {
    lines.push(`- ${check.id} ${check.label}: ${check.status}`);
    lines.push(`  evidence: ${check.evidenceRequired}`);
  }
  lines.push(
    "",
    "Next commands:",
    `- ${status.nextCommands.status}`,
    `- ${status.nextCommands.readiness}`,
    `- ${status.nextCommands.launchTerminal}`,
    `- ${status.nextCommands.checklist}`,
    `- ${status.nextCommands.operatorRunbook}`,
    `- ${status.nextCommands.closeoutWizardAll}`,
    `- ${status.nextCommands.closeoutWizard}`,
    `- ${status.nextCommands.evidenceTemplate}`,
    `- ${status.nextCommands.evidenceRecord}`,
    `- ${status.nextCommands.evidenceCheck}`,
    `- ${status.nextCommands.richTuiSmoke}`,
    `- ${status.nextCommands.realProviderRichTuiSmoke}`,
    "",
    "Phase 2 is not complete until C1, C2, and C3 evidence is recorded in the plan.",
  );
  return lines.join("\n");
}

export function renderPhaseTwoManualChecklist(): string {
  return [
    "Phase 2 manual closure checklist",
    "Run this any time with: soloclaw phase2 checklist",
    "Compatibility alias: agent phase2 checklist",
    "Step-by-step guided path: soloclaw phase2 closeout-guide",
    "Check real-provider readiness with: soloclaw phase2 readiness",
    "Open a real terminal with: soloclaw phase2 launch-terminal",
    "Print the launch command with: soloclaw phase2 launch-terminal --print",
    "One-sitting operator runbook: soloclaw phase2 operator-runbook",
    "One-sitting closeout: soloclaw phase2 closeout-wizard --all",
    "Guided evidence/review prompts: soloclaw phase2 closeout-wizard --section C1|C2|C3",
    "Paste-safe notes only: soloclaw phase2 evidence-template",
    "Record paste-safe notes into the plan: soloclaw phase2 evidence-record --section C1|C2|C3",
    "Check evidence notes for required sections and secret-looking text: soloclaw phase2 evidence-check",
    "",
    "C1 external terminal rich TUI",
    "  Run from a real Windows Terminal or PowerShell window outside hosted shells:",
    "    Set-Location E:\\code\\agent",
    "    node dist\\cli\\index.js",
    "  Verify: welcome screen, current workspace/model, prompt cursor, F2 mode cycling, ctrl+p palette, arrow keys, Space selection, Enter submit, Esc/Ctrl+C cursor restore.",
    "",
    "C2 real-provider setup",
    "  Before the manual run, check local setup readiness:",
    "    soloclaw phase2 readiness",
    "  In the same rich TUI:",
    "    /phase2 readiness",
    "    If readiness reports a problem, run /model setup; otherwise skip setup.",
    "    /model check",
    "    Ask a small read-only task, for example: inspect package.json scripts without modifying files.",
    "  Verify: provider -> model -> API key flow, base URL visible, API key not echoed, live progress rows, final answer.",
    "  Optional automated preflight after setup:",
    "    node dist\\cli\\index.js smoke --rich-tui-real-provider",
    "  This preflight proves the injected rich TUI path with the configured real provider, but it still does not replace the C2 external-terminal observation.",
    "  Leak scan after setup:",
    '    rg -n --hidden "sk-[A-Za-z0-9_-]{12,}|Authorization:\\s*Bearer|AGENT_SECRETS_PASSPHRASE=.+" .agent',
    "  Expected: no plaintext API key or bearer token. Do not paste key text into evidence notes.",
    "",
    "C3 automated completion gate",
    "  Run after C1 and C2 evidence is recorded:",
    "    npm.cmd run check",
    "    npm.cmd test",
    "    node dist\\cli\\index.js smoke --rich-tui",
    "    node dist\\cli\\index.js smoke --rich-tui-real-provider",
    "    git diff --check",
    "    Get-ChildItem -Force -Recurse -File | Where-Object { $_.FullName -notmatch '\\\\node_modules\\\\|\\\\.git\\\\' -and $_.Name -match '\\.(tmp|bak|log|old|orig|rej|tsbuildinfo)$' } | Select-Object -ExpandProperty FullName",
    "",
    "Evidence notes template",
    "  C1 evidence:",
    "    Date:",
    "    Terminal:",
    "    Shell:",
    "    Node version:",
    "    Result:",
    "    Rendering issues:",
    "  C2 evidence:",
    "    Date:",
    "    Provider:",
    "    Model:",
    "    Base URL:",
    "    /model check result:",
    "    Task result:",
    "    Leak check:",
    "  C3 evidence:",
    "    Date:",
    "    check/test/rich smoke/git diff/temp scan:",
    "  Never record API keys, key prefixes, bearer tokens, vault passphrases, or Authorization headers.",
    "  Evidence safety check:",
    "    soloclaw phase2 evidence-check",
    "",
    "Record dated C1, C2, and C3 evidence in docs\\superpowers\\plans\\2026-06-18-soloclaw-rich-tui-event-stream.md before marking Phase 2 complete.",
  ].join("\n");
}

export function renderPhaseTwoEvidenceTemplate(): string {
  return [
    "Phase 2 evidence notes template",
    "Paste this under docs\\superpowers\\plans\\2026-06-18-soloclaw-rich-tui-event-stream.md, inside the C1/C2/C3 closure sections.",
    "Never record API keys, key prefixes, bearer tokens, vault passphrases, or Authorization headers.",
    "",
    "### C1 external terminal rich-TUI evidence",
    "",
    "- Date:",
    "- Terminal:",
    "- Shell:",
    "- Node version:",
    "- Command: node dist\\cli\\index.js",
    "- Workspace/model/status rail visible:",
    "- Prompt cursor and Chinese input redraw:",
    "- F2 Plan/Build/Goal cycling:",
    "- ctrl+p palette, arrow keys, Space, Enter:",
    "- Escape/Ctrl+C cursor restore:",
    "- Rendering issues:",
    "",
    "### C2 real-provider setup and task evidence",
    "",
    "- Date:",
    "- Provider:",
    "- Model:",
    "- Base URL:",
    "- /phase2 readiness result:",
    "- /model setup result if reconfigured:",
    "- /model check result:",
    "- Task: inspect package.json scripts without modifying files",
    "- Task result:",
    "- Live progress rows visible:",
    "- Leak check:",
    "- Secret notes: no key text, key prefix, bearer token, or passphrase recorded",
    "",
    "### C3 final automated gate evidence",
    "",
    "- Date:",
    "- npm.cmd run check:",
    "- npm.cmd test:",
    "- node dist\\cli\\index.js smoke --rich-tui:",
    "- node dist\\cli\\index.js smoke --rich-tui-real-provider:",
    "- git diff --check:",
    "- temp-file scan:",
  ].join("\n");
}

export function renderPhaseTwoCloseoutGuide(): string {
  return [
    "Phase 2 closeout guide",
    "Use this from a real Windows Terminal or PowerShell window. Do not record API keys, key prefixes, bearer tokens, vault passphrases, or Authorization headers.",
    "",
    "Step 1 - Open Soloclaw in a real terminal",
    "  soloclaw phase2 launch-terminal",
    "  Or run manually:",
    "    Set-Location E:\\code\\agent",
    "    node dist\\cli\\index.js",
    "  Check: Soloclaw screen, workspace/model/status rail, prompt cursor, F2 modes, ctrl+p palette, arrow keys, Space, Enter, Esc/Ctrl+C cursor restore.",
    "",
    "Step 2 - Run the real-provider path inside Soloclaw",
    "  /phase2 readiness",
    "  If readiness reports a problem: /model setup",
    "  /model check",
    "  Ask: Inspect package.json and report only the npm scripts whose names include test or check. Do not modify files.",
    "  Skip /model setup when readiness is already ready_for_manual_run.",
    "  Check: provider/model/API-key path, base URL visibility, no API-key echo, live progress rows, final answer.",
    "",
    "Step 3 - Record C1 and C2 paste-safe evidence",
    "  Guided option:",
    "    soloclaw phase2 closeout-wizard --section C1",
    "    soloclaw phase2 closeout-wizard --section C2",
    "  Manual option:",
    "  soloclaw phase2 evidence-record --section C1 --terminal \"Windows Terminal\" --shell \"PowerShell\" --result \"Rich TUI rendered and exited cleanly\"",
    "  soloclaw phase2 evidence-record --section C2 --provider \"deepseek\" --model \"deepseek-v4-flash\" --result \"Read-only package.json task returned an answer with live progress\"",
    "  After reviewing the saved C1/C2 evidence, check only those reviewed tasks:",
    "    soloclaw phase2 closure-task --section C1 --confirm-reviewed",
    "    soloclaw phase2 closure-task --section C2 --confirm-reviewed",
    "  Then run the leak scan from `soloclaw phase2 checklist` and record only pass/fail, never matching text.",
    "",
    "Step 4 - Run the final automated gate after C1 and C2",
    "  npm.cmd run check",
    "  npm.cmd test",
    "  node dist\\cli\\index.js smoke --rich-tui",
    "  node dist\\cli\\index.js smoke --rich-tui-real-provider",
    "  git diff --check",
    "  Record C3:",
    "    soloclaw phase2 closeout-wizard --section C3",
    "  Or record manually:",
    "    soloclaw phase2 evidence-record --section C3 --result \"Final automated gate passed; see local terminal output\"",
    "  After reviewing the saved C3 evidence, check only that reviewed task:",
    "    soloclaw phase2 closure-task --section C3 --confirm-reviewed",
    "",
    "Step 5 - Confirm closeout state",
    "  node dist\\cli\\index.js phase2 evidence-check --strict",
    "  soloclaw phase2 gate",
    "  Only after C1, C2, and C3 evidence are recorded and reviewed should the plan checkboxes be marked complete.",
  ].join("\n");
}

export function renderPhaseTwoOperatorRunbook(summary: PhaseTwoGateSummary, launch: PhaseTwoExternalTerminalLaunch): string {
  const readinessHint = summary.realProviderReadiness === "ready_for_manual_run"
    ? "ready_for_manual_run; skip /model setup unless /phase2 readiness reports a problem"
    : `${summary.realProviderReadiness}; run /model setup before /model check`;
  const blockers = summary.blockers.length > 0 ? summary.blockers.join(",") : "-";
  const nextActions = summary.nextActions.length > 0 ? summary.nextActions : ["Phase 2 gate is clear; do a final evidence review."];
  const lines = [
    "Phase 2 operator runbook",
    `workspace=${summary.workspace}`,
    `status=${summary.status}`,
    `strictEvidence=${summary.strictEvidence}`,
    `blockers=${blockers}`,
    "",
    "Current model path:",
    `- provider=${summary.readiness.activeProvider}`,
    `- model=${summary.readiness.model}`,
    `- baseUrl=${summary.readiness.baseUrl}`,
    `- readiness=${readinessHint}`,
    "",
    "One-sitting flow:",
    "1. Open a real Soloclaw terminal:",
    "   soloclaw phase2 launch-terminal",
    "   Or paste this in Windows Terminal or PowerShell:",
    `   ${launch.terminalCommand}`,
    "2. C1 checks in that window:",
    "   Confirm workspace/model/status rail, prompt cursor, F2 Plan/Build/Goal, ctrl+p palette, arrow keys, Space, Enter, and Esc/Ctrl+C cursor restore.",
    "3. C2 checks in the same Soloclaw screen:",
    "   /phase2 readiness",
    "   /model check",
    "   Inspect package.json and report only the npm scripts whose names include test or check. Do not modify files.",
    "4. Record dated paste-safe evidence after observing the screen:",
    "   Guided prompts:",
    "   soloclaw phase2 closeout-wizard --section C1",
    "   soloclaw phase2 closeout-wizard --section C2",
    "   Fallback manual commands:",
    "   soloclaw phase2 evidence-record --section C1 --terminal \"Windows Terminal\" --shell \"PowerShell\" --result \"Rich TUI rendered and exited cleanly\"",
    "   soloclaw phase2 evidence-record --section C2 --provider \"deepseek\" --model \"deepseek-v4-flash\" --result \"Read-only package.json task returned an answer with live progress\"",
    "   Only use these if the wizard is not usable.",
    "5. Review saved evidence before checking tasks:",
    "   soloclaw phase2 evidence-show --section C1",
    "   soloclaw phase2 evidence-show --section C2",
    "   soloclaw phase2 closure-task --section C1 --confirm-reviewed",
    "   soloclaw phase2 closure-task --section C2 --confirm-reviewed",
    "6. After C1 and C2 are reviewed, run C3:",
    "   soloclaw phase2 final-gate",
    "   soloclaw phase2 closeout-wizard --section C3",
    "   Fallback manual command:",
    "   soloclaw phase2 evidence-record --section C3 --result \"Final automated gate passed; see local terminal output\"",
    "   Only use the fallback if the wizard is not usable.",
    "   soloclaw phase2 evidence-show --section C3",
    "   soloclaw phase2 closure-task --section C3 --confirm-reviewed",
    "   node dist\\cli\\index.js phase2 evidence-check --strict",
    "   soloclaw phase2 gate",
    "",
    "Current next actions:",
  ];
  for (const action of nextActions) {
    lines.push(`- ${action}`);
  }
  lines.push(
    "",
    "Never record API keys, key prefixes, bearer tokens, vault passphrases, or authorization headers.",
  );
  return lines.join("\n");
}

export function renderPhaseTwoCloseoutWizardGuide(): string {
  return [
    "Phase 2 closeout wizard",
    "Run this from a normal terminal after the matching manual observation. It records dated paste-safe evidence, shows the redacted evidence back to you, and only checks the closure task after you type yes to confirm review.",
    "",
    "Commands:",
    "  soloclaw phase2 closeout-wizard --all",
    "  soloclaw phase2 closeout-wizard --section C1",
    "  soloclaw phase2 closeout-wizard --section C2",
    "  soloclaw phase2 closeout-wizard --section C3",
    "",
    "Use --all for one guided pass through C1, C2, and C3 in order.",
    "Use C1 after checking the real Soloclaw terminal screen and keyboard behavior.",
    "Use C2 after running /phase2 readiness, /model check, and the read-only package.json task with the real provider.",
    "Use C3 after final-gate passes.",
    "",
    "Never record API keys, key prefixes, bearer tokens, vault passphrases, or Authorization headers.",
  ].join("\n");
}

export async function recordPhaseTwoEvidence(
  workspace: string,
  input: PhaseTwoEvidenceRecordInput,
): Promise<PhaseTwoEvidenceRecordResult> {
  const file = path.resolve(input.filePath ?? phaseTwoDefaultEvidencePath(workspace));
  const text = await fs.readFile(file, "utf8");
  const inputSecretMatches = countEvidenceSecretMatches([
    input.date,
    ...Object.values(input.fields ?? {}),
  ].filter((value): value is string => typeof value === "string").join("\n"));
  if (inputSecretMatches > 0) {
    throw new Error("Refusing to record evidence because it contains secret-looking text. Remove API keys, key prefixes, bearer tokens, vault passphrases, and Authorization headers.");
  }
  const evidenceLines = buildPhaseTwoEvidenceRecordLines(input);
  const evidenceBlock = evidenceLines.join("\n");
  const secretMatches = countEvidenceSecretMatches(evidenceBlock);
  if (secretMatches > 0) {
    throw new Error("Refusing to record evidence because it contains secret-looking text. Remove API keys, key prefixes, bearer tokens, vault passphrases, and Authorization headers.");
  }

  const range = phaseTwoEvidenceInsertionRange(text, input.section);
  let before = text.slice(0, range.end).replace(/[ \t]+$/u, "");
  const after = text.slice(range.end);
  if (!before.endsWith("\n")) {
    before += "\n";
  }
  if (!before.endsWith("\n\n")) {
    before += "\n";
  }
  let updated = `${before}${evidenceBlock}\n`;
  if (after.length > 0 && !after.startsWith("\n")) {
    updated += "\n";
  }
  updated += after;
  await fs.writeFile(file, updated, "utf8");

  const postCheck = await buildPhaseTwoEvidenceCheck(workspace, { filePath: file });
  if (postCheck.secretMatches > 0) {
    throw new Error("Evidence was not recorded safely; secret-looking text was detected after writing.");
  }

  return {
    status: "recorded",
    file,
    section: input.section,
    insertedLines: evidenceLines.length,
    secretMatches: postCheck.secretMatches,
  };
}

export function renderPhaseTwoEvidenceRecord(result: PhaseTwoEvidenceRecordResult): string {
  return [
    "Phase 2 evidence recorded",
    `status=${result.status}`,
    `section=${result.section}`,
    `file=${result.file}`,
    `insertedLines=${result.insertedLines}`,
    `secretMatches=${result.secretMatches}`,
    "",
    "This only records paste-safe evidence. It does not check C1/C2/C3 completion boxes.",
    "After the required evidence is recorded and reviewed, rerun `soloclaw phase2 evidence-check --strict` and `soloclaw phase2 gate`.",
  ].join("\n");
}

export async function buildPhaseTwoEvidenceReview(
  workspace: string,
  input: { section: PhaseTwoEvidenceRecordSection; filePath?: string },
): Promise<PhaseTwoEvidenceReview> {
  const file = path.resolve(input.filePath ?? phaseTwoDefaultEvidencePath(workspace));
  const text = await fs.readFile(file, "utf8");
  const range = phaseTwoEvidenceInsertionRange(text, input.section);
  const rawSection = trimPhaseTwoEvidenceReviewText(text.slice(range.start, range.end));
  if (!rawSection) {
    throw new Error(`No ${input.section} evidence text was found.`);
  }
  const secretMatches = countEvidenceSecretMatches(rawSection);
  const hasDatedEvidence = sectionHasDate(rawSection);
  return {
    file,
    section: input.section,
    status: hasDatedEvidence ? "ready_for_review" : "missing_dated_evidence",
    secretMatches,
    text: redactPhaseTwoEvidenceText(rawSection),
    nextCommand: hasDatedEvidence
      ? `soloclaw phase2 closure-task --section ${input.section} --confirm-reviewed`
      : phaseTwoCloseoutWizardCommand(input.section),
  };
}

export function renderPhaseTwoEvidenceReview(review: PhaseTwoEvidenceReview): string {
  return [
    "Phase 2 evidence review",
    `status=${review.status}`,
    `section=${review.section}`,
    `file=${review.file}`,
    `secretMatches=${review.secretMatches}`,
    "",
    "Evidence:",
    review.text,
    "",
    `next=${review.nextCommand}`,
    review.status === "ready_for_review"
      ? "Only run the next command after you have personally reviewed this evidence."
      : "Use the closeout wizard to record dated, paste-safe evidence before running any closure-task command.",
    "Secret-looking text is redacted for display; clean the evidence file before closure if secretMatches is greater than 0.",
  ].join("\n");
}

export async function checkPhaseTwoClosureTask(
  workspace: string,
  input: PhaseTwoClosureTaskInput,
): Promise<PhaseTwoClosureTaskResult> {
  if (input.confirmReviewed !== true) {
    throw new Error("Refusing to check a Phase 2 closure task without --confirm-reviewed. Run the manual observation first, record paste-safe evidence, then retry with --confirm-reviewed.");
  }
  const file = path.resolve(input.filePath ?? phaseTwoDefaultEvidencePath(workspace));
  const preCheck = await buildPhaseTwoEvidenceCheck(workspace, { filePath: file, strict: true });
  if (preCheck.secretMatches > 0 || phaseTwoEvidenceCheckFailed(preCheck, "secretMaterial")) {
    throw new Error("Refusing to check a Phase 2 closure task because secret-looking evidence text was detected.");
  }
  const sectionLower = input.section.toLowerCase();
  if (phaseTwoEvidenceCheckFailed(preCheck, `${sectionLower}Section`) || phaseTwoEvidenceCheckFailed(preCheck, `${sectionLower}DatedEvidence`)) {
    throw new Error(`Refusing to check ${input.section}; required dated evidence for ${input.section} is missing.`);
  }

  const text = await fs.readFile(file, "utf8");
  const pattern = new RegExp(`^(?<prefix>\\s*- \\[)(?<mark>[ xX])(?<suffix>\\] \\*\\*${input.section}:.*)$`, "m");
  const match = text.match(pattern);
  if (!match) {
    throw new Error(`No ${input.section} closure task checkbox was found.`);
  }
  const status: PhaseTwoClosureTaskResult["status"] = match.groups?.mark?.toLowerCase() === "x" ? "already_checked" : "checked";
  if (status === "checked") {
    const updated = text.replace(pattern, `$<prefix>x$<suffix>`);
    await fs.writeFile(file, updated, "utf8");
  }
  const postCheck = await buildPhaseTwoEvidenceCheck(workspace, { filePath: file });
  if (postCheck.secretMatches > 0) {
    throw new Error("Closure task was not updated safely; secret-looking text was detected after writing.");
  }
  return {
    status,
    file,
    section: input.section,
    secretMatches: postCheck.secretMatches,
  };
}

export function renderPhaseTwoClosureTask(result: PhaseTwoClosureTaskResult): string {
  return [
    "Phase 2 closure task updated",
    `status=${result.status}`,
    `section=${result.section}`,
    `file=${result.file}`,
    `secretMatches=${result.secretMatches}`,
    "",
    "This only checks the requested closure task. It does not mark Phase 2 complete by itself.",
    "After C1, C2, and C3 are checked, rerun `node dist\\cli\\index.js phase2 evidence-check --strict` and `soloclaw phase2 gate`.",
  ].join("\n");
}

export function phaseTwoDefaultEvidencePath(workspace: string): string {
  return path.join(path.resolve(workspace), PHASE_TWO_PLAN_RELATIVE_PATH);
}

export async function buildPhaseTwoEvidenceCheck(
  workspace: string,
  options: { filePath?: string; strict?: boolean } = {},
): Promise<PhaseTwoEvidenceCheck> {
  const file = path.resolve(options.filePath ?? phaseTwoDefaultEvidencePath(workspace));
  const strict = options.strict === true;
  let text = "";
  let fileReadable = true;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (error) {
    if (!isNodeErrorWithCode(error, "ENOENT")) {
      throw error;
    }
    fileReadable = false;
  }

  const secretMatches = fileReadable ? countEvidenceSecretMatches(stripMarkdownCodeForEvidenceScan(text)) : 0;
  const c1Present = fileReadable && /(C1 external terminal rich[-\s]?TUI evidence|C1:\s*Record a real external terminal rich[-\s]?TUI smoke)/i.test(text);
  const c2Present = fileReadable && /(C2 real-provider setup and task evidence|C2:\s*Record one real-provider setup and natural-language run)/i.test(text);
  const c3Present = fileReadable && /(C3 final automated gate evidence|C3:\s*Re-run the full automated completion gate)/i.test(text);
  const c1Dated = fileReadable && sectionHasDate(extractPhaseTwoEvidenceSection(text, "C1"));
  const c2Dated = fileReadable && sectionHasDate(extractPhaseTwoEvidenceSection(text, "C2"));
  const c3Dated = fileReadable && sectionHasDate(extractPhaseTwoEvidenceSection(text, "C3"));
  const c1ClosureTask = fileReadable ? phaseTwoClosureTaskState(text, "C1") : "absent";
  const c2ClosureTask = fileReadable ? phaseTwoClosureTaskState(text, "C2") : "absent";
  const c3ClosureTask = fileReadable ? phaseTwoClosureTaskState(text, "C3") : "absent";
  const c1StrictEvidence = c1Dated && c1ClosureTask !== "incomplete";
  const c2StrictEvidence = c2Dated && c2ClosureTask !== "incomplete";
  const c3StrictEvidence = c3Dated && c3ClosureTask !== "incomplete";
  const datedEvidencePresent = c1Dated && c2Dated && c3Dated;
  const closureTasksComplete = c1ClosureTask !== "incomplete" && c2ClosureTask !== "incomplete" && c3ClosureTask !== "incomplete";
  const checks: PhaseTwoRealProviderReadinessCheck[] = [
    {
      id: "fileReadable",
      status: fileReadable ? "pass" : "fail",
      summary: fileReadable ? "Evidence file is readable." : "Evidence file was not found or could not be read.",
    },
    {
      id: "c1Section",
      status: c1Present ? "pass" : "fail",
      summary: c1Present ? "C1 external terminal evidence section is present." : "Missing C1 external terminal evidence section.",
    },
    {
      id: "c2Section",
      status: c2Present ? "pass" : "fail",
      summary: c2Present ? "C2 real-provider task evidence section is present." : "Missing C2 real-provider task evidence section.",
    },
    {
      id: "c3Section",
      status: c3Present ? "pass" : "fail",
      summary: c3Present ? "C3 final gate evidence section is present." : "Missing C3 final gate evidence section.",
    },
    {
      id: "secretMaterial",
      status: secretMatches === 0 ? "pass" : "fail",
      summary: secretMatches === 0
        ? "No plaintext API-key, bearer-token, or passphrase assignment shapes were found; matches=0."
        : `Found secret-looking match(es); matches=${secretMatches}. Remove them before recording evidence.`,
    },
  ];
  if (strict) {
    checks.push(
      {
        id: "c1DatedEvidence",
        status: c1Dated ? "pass" : "fail",
        summary: c1Dated ? "C1 evidence includes a dated entry." : "C1 evidence is missing a dated entry.",
      },
      {
        id: "c2DatedEvidence",
        status: c2Dated ? "pass" : "fail",
        summary: c2Dated ? "C2 evidence includes a dated entry." : "C2 evidence is missing a dated entry.",
      },
      {
        id: "c3DatedEvidence",
        status: c3Dated ? "pass" : "fail",
        summary: c3Dated ? "C3 evidence includes a dated entry." : "C3 evidence is missing a dated entry.",
      },
      {
        id: "c1ClosureTaskComplete",
        status: closureTaskCheckStatus(c1ClosureTask),
        summary: closureTaskCheckSummary("C1", c1ClosureTask),
      },
      {
        id: "c2ClosureTaskComplete",
        status: closureTaskCheckStatus(c2ClosureTask),
        summary: closureTaskCheckSummary("C2", c2ClosureTask),
      },
      {
        id: "c3ClosureTaskComplete",
        status: closureTaskCheckStatus(c3ClosureTask),
        summary: closureTaskCheckSummary("C3", c3ClosureTask),
      },
    );
  }
  return {
    status: phaseTwoEvidenceCheckStatus(
      fileReadable,
      c1Present && c2Present && c3Present,
      secretMatches,
      strict,
      datedEvidencePresent,
      closureTasksComplete,
      c1StrictEvidence && c2StrictEvidence && c3StrictEvidence,
    ),
    file,
    strict,
    secretMatches,
    checks,
  };
}

export function renderPhaseTwoEvidenceCheck(check: PhaseTwoEvidenceCheck): string {
  const lines = [
    "Phase 2 evidence check",
    `status=${check.status}`,
    `file=${check.file}`,
    `strict=${check.strict ? "true" : "false"}`,
    `secretMatches=${check.secretMatches}`,
    "",
    "Checks:",
  ];
  for (const item of check.checks) {
    lines.push(`- ${item.id}: ${item.status}`);
    lines.push(`  ${item.summary}`);
  }
  lines.push(
    "",
    "This check does not satisfy C1, C2, or C3; it only verifies that the evidence notes have required sections and no obvious plaintext secret shapes.",
    "Never record API keys, key prefixes, bearer tokens, vault passphrases, or Authorization headers.",
  );
  return lines.join("\n");
}

export async function buildPhaseTwoGateSummary(workspace: string): Promise<PhaseTwoGateSummary> {
  const resolvedWorkspace = path.resolve(workspace);
  const [readiness, evidence] = await Promise.all([
    buildPhaseTwoRealProviderReadiness(resolvedWorkspace),
    buildPhaseTwoEvidenceCheck(resolvedWorkspace, { strict: true }),
  ]);
  const blockers = phaseTwoGateBlockers(readiness, evidence);
  return {
    status: phaseTwoGateStatus(readiness, evidence, blockers),
    workspace: resolvedWorkspace,
    realProviderReadiness: readiness.status,
    strictEvidence: evidence.status,
    blockers,
    nextActions: phaseTwoGateNextActions(blockers, readiness, evidence),
    readiness,
    evidence,
  };
}

export function renderPhaseTwoGateSummary(summary: PhaseTwoGateSummary): string {
  const lines = [
    "Phase 2 gate summary",
    `status=${summary.status}`,
    `workspace=${summary.workspace}`,
    `realProviderReadiness=${summary.realProviderReadiness}`,
    `strictEvidence=${summary.strictEvidence}`,
    `blockers=${summary.blockers.join(",") || "-"}`,
    "",
    "Blocking checks:",
  ];
  const blockingChecks = [
    ...summary.readiness.checks.filter((check) => check.status === "fail"),
    ...summary.evidence.checks.filter((check) => check.status === "fail"),
  ];
  if (blockingChecks.length === 0) {
    lines.push("- none");
  } else {
    for (const check of blockingChecks) {
      lines.push(`- ${check.id}: ${check.status}`);
      lines.push(`  ${check.summary}`);
    }
  }
  lines.push("", "Next actions:");
  for (const action of summary.nextActions) {
    lines.push(`- ${action}`);
  }
  lines.push(
    "",
    "Run `soloclaw phase2 gate` again after recording evidence. Do not record API keys, key prefixes, bearer tokens, vault passphrases, or Authorization headers.",
  );
  return lines.join("\n");
}

export async function buildPhaseTwoNextAction(workspace: string): Promise<PhaseTwoNextAction> {
  const summary = await buildPhaseTwoGateSummary(workspace);
  const action = summary.nextActions[0] ?? "Phase 2 evidence gate is clear. Do a final review before marking completion.";
  return {
    status: summary.status,
    workspace: summary.workspace,
    blocker: summary.blockers[0],
    action,
    remainingActions: summary.nextActions.length,
    realProviderReadiness: summary.realProviderReadiness,
    strictEvidence: summary.strictEvidence,
  };
}

export function renderPhaseTwoNextAction(next: PhaseTwoNextAction): string {
  return [
    "Phase 2 next action",
    `status=${next.status}`,
    `workspace=${next.workspace}`,
    `blocker=${next.blocker ?? "-"}`,
    `realProviderReadiness=${next.realProviderReadiness}`,
    `strictEvidence=${next.strictEvidence}`,
    `remainingActions=${next.remainingActions}`,
    "",
    "Next:",
    `- ${next.action}`,
    "",
    "After this action, rerun `soloclaw phase2 next` or `soloclaw phase2 gate`.",
    "Never record API keys, key prefixes, bearer tokens, vault passphrases, or Authorization headers.",
  ].join("\n");
}

export async function buildPhaseTwoReviewBoard(workspace: string): Promise<PhaseTwoReviewBoard> {
  const summary = await buildPhaseTwoGateSummary(workspace);
  const itemFor = (section: PhaseTwoEvidenceRecordSection): PhaseTwoReviewItem => {
    const lower = section.toLowerCase();
    const sectionStatus = evidenceStatus(summary.evidence, `${lower}Section`);
    const datedStatus = evidenceStatus(summary.evidence, `${lower}DatedEvidence`);
    const closureStatus = evidenceStatus(summary.evidence, `${lower}ClosureTaskComplete`);
    const evidence = sectionStatus !== "pass" ? "missing" : datedStatus !== "pass" ? "undated" : "recorded";
    const review = evidence !== "recorded" ? "waiting_for_evidence" : closureStatus === "pass" ? "checked" : "needs_review";
    const nextCommand = review === "checked"
      ? "done"
      : evidence === "recorded"
        ? `soloclaw phase2 closure-task --section ${section} --confirm-reviewed`
        : phaseTwoCloseoutWizardCommand(section);
    return {
      section,
      evidence,
      review,
      summary: evidenceReviewSummary(section, evidence, review),
      nextCommand,
    };
  };
  return {
    status: summary.status,
    workspace: summary.workspace,
    realProviderReadiness: summary.realProviderReadiness,
    strictEvidence: summary.strictEvidence,
    secretMatches: summary.evidence.secretMatches,
    items: [itemFor("C1"), itemFor("C2"), itemFor("C3")],
    nextReviewAction: phaseTwoNextReviewAction([itemFor("C1"), itemFor("C2"), itemFor("C3")]),
  };
}

export function renderPhaseTwoReviewBoard(board: PhaseTwoReviewBoard): string {
  const lines = [
    "Phase 2 review board",
    `status=${board.status}`,
    `workspace=${board.workspace}`,
    `realProviderReadiness=${board.realProviderReadiness}`,
    `strictEvidence=${board.strictEvidence}`,
    `secretMatches=${board.secretMatches}`,
    "",
    "Items:",
  ];
  for (const item of board.items) {
    lines.push(`- ${item.section} evidence=${item.evidence} review=${item.review}`);
    lines.push(`  ${item.summary}`);
    lines.push(`  next=${item.nextCommand}`);
  }
  lines.push(
    "",
    "Next review action:",
    `- ${board.nextReviewAction}`,
    "",
    "Use `soloclaw phase2 next` for the single next step, or `soloclaw phase2 gate` for the full gate.",
    "Never record API keys, key prefixes, bearer tokens, vault passphrases, or Authorization headers.",
  );
  return lines.join("\n");
}

export function buildPhaseTwoExternalTerminalLaunch(workspace: string): PhaseTwoExternalTerminalLaunch {
  const resolvedWorkspace = path.resolve(workspace);
  const windowTitle = `Soloclaw Phase 2 - ${resolvedWorkspace}`;
  const shellCommand = `[Console]::Title = ${quotePowerShellSingle(windowTitle)}; Set-Location -LiteralPath ${quotePowerShellSingle(resolvedWorkspace)}; node dist\\cli\\index.js`;
  return {
    workspace: resolvedWorkspace,
    method: "powershell-start-process",
    windowTitle,
    shellCommand,
    terminalCommand: `powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -Command "${escapePowerShellDouble(shellCommand)}"`,
  };
}

export function buildPhaseTwoExternalTerminalStartProcessCommand(launch: PhaseTwoExternalTerminalLaunch): string {
  const argumentList = [
    "-NoExit",
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    `"${escapePowerShellDouble(launch.shellCommand)}"`,
  ].join(" ");
  return `$process = Start-Process -FilePath powershell.exe -ArgumentList ${quotePowerShellSingle(argumentList)} -WindowStyle Normal -PassThru; $process.Id`;
}

export function renderPhaseTwoExternalTerminalLaunch(
  launch: PhaseTwoExternalTerminalLaunch,
  launched: boolean,
  result: PhaseTwoExternalTerminalLaunchResult = {},
): string {
  const lines = [
    "Phase 2 external terminal launcher",
    `workspace=${launch.workspace}`,
    `launched=${launched}`,
    `method=${launch.method}`,
    `windowTitle=${launch.windowTitle}`,
  ];
  if (result.pid !== undefined) {
    lines.push(`pid=${result.pid}`);
  }
  lines.push(
    "",
    "Command:",
    `  ${launch.terminalCommand}`,
    "",
    "Manual closeout path inside the Soloclaw screen:",
    "  1. Confirm C1 rendering, cursor restore, F2 mode cycling, and ctrl+p command palette behavior.",
    "  2. Run /phase2 checklist if you want the checklist inside the rich TUI.",
    "  3. Run /phase2 readiness; if it reports a problem run /model setup, otherwise skip setup; then run /model check and a small read-only natural-language task.",
    "  4. Use soloclaw phase2 evidence-template for paste-safe C1/C2/C3 notes.",
    "",
    "If a window does not stay open, copy the command above into Windows Terminal or PowerShell.",
    "Never record API keys, key prefixes, bearer tokens, vault passphrases, or Authorization headers.",
  );
  return lines.join("\n");
}

export function renderPhaseTwoFinalGatePlan(workspace: string): string {
  const resolvedWorkspace = path.resolve(workspace);
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const cliDisplayPath = "dist\\cli\\index.js";
  const steps = [
    { label: "TypeScript check", display: `${npmCommand} run check` },
    { label: "Full test suite", display: `${npmCommand} test` },
    { label: "Rich TUI smoke", display: `node ${cliDisplayPath} smoke --rich-tui --workspace ${resolvedWorkspace}` },
    { label: "Real-provider rich TUI smoke", display: `node ${cliDisplayPath} smoke --rich-tui-real-provider --workspace ${resolvedWorkspace}` },
    { label: "Whitespace check", display: "git diff --check" },
    { label: "Temp-file scan", display: "temp-file scan: find .tmp/.bak/.log/.old/.orig/.rej/.tsbuildinfo outside .git, node_modules, and .agent/tmp" },
  ];
  const lines = [
    "Phase 2 final automated gate",
    `workspace=${resolvedWorkspace}`,
    "",
    "Commands:",
  ];
  for (const step of steps) {
    lines.push(`- ${step.label}: ${step.display}`);
  }
  lines.push(
    "",
    "After these pass, record, review, and check C3 with the guided wizard:",
    "  soloclaw phase2 closeout-wizard --section C3",
    "Fallback manual command:",
    '  soloclaw phase2 evidence-record --section C3 --result "Final automated gate passed; see local terminal output"',
    "Only use the fallback if the wizard is not usable. Then review the saved C3 evidence and check only C3:",
    "  soloclaw phase2 closure-task --section C3 --confirm-reviewed",
    "",
    "This command only prints the C3 gate plan. Run `soloclaw phase2 final-gate` in a normal terminal after C1 and C2 are reviewed.",
    "Never record API keys, key prefixes, bearer tokens, vault passphrases, or Authorization headers.",
  );
  return lines.join("\n");
}

function quotePowerShellSingle(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function escapePowerShellDouble(value: string): string {
  return value.replace(/`/g, "``").replace(/"/g, '`"');
}

function phaseTwoNextReviewAction(items: PhaseTwoReviewItem[]): string {
  const next = items.find((item) => item.review !== "checked");
  if (!next) {
    return "C1/C2/C3 review tasks are checked; rerun `soloclaw phase2 gate`.";
  }
  if (next.evidence === "recorded") {
    return `${next.section}: review saved evidence, then run \`${next.nextCommand}\`.`;
  }
  return `${next.section}: record and review dated evidence with \`${next.nextCommand}\` before review.`;
}

function evidenceStatus(evidence: PhaseTwoEvidenceCheck, id: string): PhaseTwoReadinessCheckStatus | undefined {
  return evidence.checks.find((check) => check.id === id)?.status;
}

function evidenceReviewSummary(
  section: PhaseTwoEvidenceRecordSection,
  evidence: PhaseTwoReviewItem["evidence"],
  review: PhaseTwoReviewItem["review"],
): string {
  if (review === "checked") {
    return `${section} evidence has been reviewed and checked.`;
  }
  if (evidence === "recorded") {
    return `${section} dated evidence is present; review it, then run the closure-task command.`;
  }
  if (evidence === "undated") {
    return `${section} evidence exists but needs a dated entry before review.`;
  }
  return `${section} evidence is missing; record paste-safe evidence before review.`;
}

function phaseTwoGateStatus(
  readiness: PhaseTwoRealProviderReadiness,
  evidence: PhaseTwoEvidenceCheck,
  blockers: string[],
): PhaseTwoGateSummary["status"] {
  if (readiness.status === "secret_leak_detected" || evidence.status === "secret_leak_detected") {
    return "secret_leak_detected";
  }
  return blockers.length === 0 ? "ready_for_completion" : "blocked_manual_evidence";
}

function phaseTwoGateBlockers(readiness: PhaseTwoRealProviderReadiness, evidence: PhaseTwoEvidenceCheck): string[] {
  const blockers = new Set<string>();
  if (phaseTwoEvidenceCheckFailed(evidence, "c1Section") || phaseTwoEvidenceCheckFailed(evidence, "c1DatedEvidence") || phaseTwoEvidenceCheckFailed(evidence, "c1ClosureTaskComplete")) {
    blockers.add("C1");
  }
  if (phaseTwoEvidenceCheckFailed(evidence, "c2Section") || phaseTwoEvidenceCheckFailed(evidence, "c2DatedEvidence") || phaseTwoEvidenceCheckFailed(evidence, "c2ClosureTaskComplete")) {
    blockers.add("C2");
  }
  if (phaseTwoEvidenceCheckFailed(evidence, "c3Section") || phaseTwoEvidenceCheckFailed(evidence, "c3DatedEvidence") || phaseTwoEvidenceCheckFailed(evidence, "c3ClosureTaskComplete")) {
    blockers.add("C3");
  }
  if (readiness.status !== "ready_for_manual_run") {
    blockers.add("real-provider");
  }
  if (evidence.status === "secret_leak_detected" || phaseTwoEvidenceCheckFailed(evidence, "secretMaterial")) {
    blockers.add("secret-hygiene");
  }
  return ["C1", "C2", "C3", "real-provider", "secret-hygiene"].filter((item) => blockers.has(item));
}

function phaseTwoEvidenceCheckFailed(evidence: PhaseTwoEvidenceCheck, id: string): boolean {
  return evidence.checks.some((check) => check.id === id && check.status === "fail");
}

function phaseTwoGateNextActions(blockers: string[], readiness: PhaseTwoRealProviderReadiness, evidence: PhaseTwoEvidenceCheck): string[] {
  const actions: string[] = [];
  if (blockers.includes("C1")) {
    actions.push(phaseTwoSectionEvidenceReady(evidence, "c1")
      ? "C1: review saved evidence, then run `soloclaw phase2 closure-task --section C1 --confirm-reviewed`."
      : `C1: run \`soloclaw phase2 launch-terminal\`, verify the real Soloclaw TTY, then run \`${phaseTwoCloseoutWizardCommand("C1")}\` to record/review evidence and check the C1 closure task. For one-sitting closeout after all C1/C2/C3 observations are ready, run \`${phaseTwoCloseoutWizardAllCommand()}\`.`);
  }
  if (blockers.includes("C2") || blockers.includes("real-provider")) {
    if (!blockers.includes("real-provider") && phaseTwoSectionEvidenceReady(evidence, "c2")) {
      actions.push("C2: review saved evidence, then run `soloclaw phase2 closure-task --section C2 --confirm-reviewed`.");
    } else {
      const setupStep = readiness.status === "ready_for_manual_run"
        ? "skip `/model setup` unless readiness reports a problem"
        : "run `/model setup` before `/model check`";
      actions.push(`C2: in the rich TUI run \`/phase2 readiness\`, ${setupStep}, then run \`/model check\` and the read-only package.json task; after observing it, run \`${phaseTwoCloseoutWizardCommand("C2")}\` without secrets. If C1/C2/C3 observations are all ready, use \`${phaseTwoCloseoutWizardAllCommand()}\`.`);
    }
  }
  if (blockers.includes("secret-hygiene")) {
    actions.push("Secret hygiene: remove secret-looking evidence text, then rerun `soloclaw phase2 evidence-check --strict`.");
  }
  if (blockers.includes("C3")) {
    actions.push(phaseTwoSectionEvidenceReady(evidence, "c3")
      ? "C3: review saved evidence, then run `soloclaw phase2 closure-task --section C3 --confirm-reviewed`."
      : `C3: after C1 and C2, run the final automated gate, then run \`${phaseTwoCloseoutWizardCommand("C3")}\` or \`${phaseTwoCloseoutWizardAllCommand()}\` if all C1/C2/C3 observations are ready; after that rerun \`node dist\\cli\\index.js phase2 evidence-check --strict\` and \`soloclaw phase2 gate\`.`);
  }
  if (actions.length === 0) {
    actions.push("Phase 2 evidence gate is clear. Do a final review, then mark the goal complete only if every requirement is verified.");
  }
  return actions;
}

function phaseTwoCloseoutWizardCommand(section: PhaseTwoEvidenceRecordSection): string {
  return `soloclaw phase2 closeout-wizard --section ${section}`;
}

function phaseTwoCloseoutWizardAllCommand(): string {
  return "soloclaw phase2 closeout-wizard --all";
}

function phaseTwoSectionEvidenceReady(evidence: PhaseTwoEvidenceCheck, section: "c1" | "c2" | "c3"): boolean {
  return evidenceStatus(evidence, `${section}Section`) === "pass"
    && evidenceStatus(evidence, `${section}DatedEvidence`) === "pass"
    && evidenceStatus(evidence, `${section}ClosureTaskComplete`) === "fail";
}

export async function buildPhaseTwoRealProviderReadiness(workspace: string): Promise<PhaseTwoRealProviderReadiness> {
  const resolvedWorkspace = path.resolve(workspace);
  const profileStore = new LocalProviderProfileStore(path.join(resolvedWorkspace, ".agent"));
  const profiles = await profileStore.list();
  const activeProvider = (await profileStore.getDefaultProvider()) ?? "mock";
  const profile = profiles.find((entry) => entry.name === activeProvider) ?? profiles.find((entry) => entry.name === "mock");
  const isRealProvider = Boolean(profile && profile.protocol !== "mock" && activeProvider !== "mock");
  const envNames = profile?.apiKeyEnvNames ?? [];
  const presentEnvNames = envNames.filter((name) => Boolean(process.env[name]));
  const hasSecretRef = Boolean(profile?.apiKeySecretRef);
  const vaultPath = path.join(resolvedWorkspace, ".agent", "secrets.vault.json");
  const vaultKeyPath = localSecretVaultPassphraseFile(resolvedWorkspace);
  const vaultExists = await fileExists(vaultPath);
  const vaultKeyExists = await fileExists(vaultKeyPath);
  const leakScan = await scanPhaseTwoSecretLeakShapes(resolvedWorkspace);
  const apiKeyReady = isRealProvider && (hasSecretRef || presentEnvNames.length > 0);
  const secretStorageReady = !isRealProvider
    ? false
    : hasSecretRef
      ? vaultExists && vaultKeyExists
      : presentEnvNames.length > 0;
  const checks: PhaseTwoRealProviderReadinessCheck[] = [
    {
      id: "realProviderConfigured",
      status: isRealProvider ? "pass" : "fail",
      summary: isRealProvider ? `Active provider is ${activeProvider}.` : "Active provider is mock; configure a real provider through /model setup.",
    },
    {
      id: "baseUrlConfigured",
      status: isRealProvider && profile?.defaultBaseUrl ? "pass" : isRealProvider ? "fail" : "skip",
      summary: profile?.defaultBaseUrl ? `Base URL configured: ${profile.defaultBaseUrl}` : "No base URL is configured for the active provider.",
    },
    {
      id: "apiKeyReference",
      status: apiKeyReady ? "pass" : isRealProvider ? "fail" : "skip",
      summary: hasSecretRef
        ? "Encrypted secret reference is configured."
        : presentEnvNames.length > 0
          ? `Environment key is available through ${presentEnvNames.join(",")}.`
          : envNames.length > 0
            ? `No configured API key source is available; expected one of ${envNames.join(",")}.`
            : "No API key source is configured.",
    },
    {
      id: "secretStorage",
      status: secretStorageReady ? "pass" : isRealProvider ? "fail" : "skip",
      summary: hasSecretRef
        ? vaultExists && vaultKeyExists
          ? "Encrypted vault and local vault key file are present."
          : "Encrypted secret reference exists, but the vault file or local vault key file is missing."
        : presentEnvNames.length > 0
          ? "Using an environment variable API key source."
          : "No secret storage or live environment key is available.",
    },
    {
      id: "secretLeakScan",
      status: leakScan.matches === 0 ? "pass" : "fail",
      summary: leakScan.matches === 0
        ? "No plaintext API-key, bearer-token, or passphrase shapes found in .agent."
        : `Found ${leakScan.matches} secret-looking match(es) in .agent; inspect and clean before C2.`,
    },
  ];
  return {
    status: phaseTwoReadinessStatus(isRealProvider, apiKeyReady, secretStorageReady, leakScan.matches),
    workspace: resolvedWorkspace,
    activeProvider,
    model: profile?.defaultModel ?? "-",
    baseUrl: profile?.defaultBaseUrl ?? "-",
    checks,
    nextCommands: {
      launchTerminal: "soloclaw phase2 launch-terminal",
      setup: "/model setup",
      modelCheck: "/model check",
      task: "Inspect package.json scripts and report test/check commands without modifying files.",
      leakScan: "Use the leak-scan command from soloclaw phase2 checklist.",
      closeoutWizardAll: phaseTwoCloseoutWizardAllCommand(),
      closeoutWizard: "soloclaw phase2 closeout-wizard --section C1|C2|C3",
      evidenceTemplate: "soloclaw phase2 evidence-template",
    },
  };
}

function phaseTwoEvidenceCheckStatus(
  fileReadable: boolean,
  sectionsPresent: boolean,
  secretMatches: number,
  strict: boolean,
  datedEvidencePresent: boolean,
  closureTasksComplete: boolean,
  strictEvidencePresent: boolean,
): PhaseTwoEvidenceCheckStatus {
  if (!fileReadable) {
    return "missing_evidence_file";
  }
  if (secretMatches > 0) {
    return "secret_leak_detected";
  }
  if (!sectionsPresent) {
    return "missing_evidence_sections";
  }
  if (!strict) {
    return "paste_safe_pending_manual_review";
  }
  if (!datedEvidencePresent) {
    return "missing_dated_evidence";
  }
  if (!closureTasksComplete) {
    return "incomplete_closure_tasks";
  }
  if (!strictEvidencePresent) {
    return "missing_dated_evidence";
  }
  return "paste_safe_pending_manual_review";
}

function buildPhaseTwoEvidenceRecordLines(input: PhaseTwoEvidenceRecordInput): string[] {
  const fields = input.fields ?? {};
  const date = singleLineEvidenceValue(input.date ?? fields.date ?? new Date().toISOString().slice(0, 10));
  const sectionTitle = {
    C1: "C1 evidence",
    C2: "C2 evidence",
    C3: "C3 evidence",
  }[input.section];
  const lines = [`- ${sectionTitle}:`, `  - Date: ${date}`];
  const entries = phaseTwoEvidenceRecordEntries(input.section);
  for (const [field, label] of entries) {
    const value = singleLineEvidenceValue(fields[field]);
    if (value) {
      lines.push(`  - ${label}: ${value}`);
    }
  }
  lines.push("  - Secret notes: no API key, key prefix, bearer token, vault passphrase, or Authorization header recorded");
  return lines;
}

function phaseTwoEvidenceRecordEntries(section: PhaseTwoEvidenceRecordSection): Array<[string, string]> {
  if (section === "C1") {
    return [
      ["terminal", "Terminal"],
      ["shell", "Shell"],
      ["nodeVersion", "Node version"],
      ["result", "Result"],
      ["renderingIssues", "Rendering issues"],
      ["note", "Notes"],
    ];
  }
  if (section === "C2") {
    return [
      ["provider", "Provider"],
      ["model", "Model"],
      ["baseUrl", "Base URL"],
      ["modelSetup", "/model setup result"],
      ["modelCheck", "/model check result"],
      ["result", "Result"],
      ["taskResult", "Task result"],
      ["liveProgress", "Live progress rows"],
      ["leakCheck", "Leak check"],
      ["note", "Notes"],
    ];
  }
  return [
    ["check", "npm.cmd run check"],
    ["test", "npm.cmd test"],
    ["richSmoke", "Rich TUI smoke"],
    ["realProviderSmoke", "Real-provider rich TUI smoke"],
    ["evidenceCheck", "Evidence check"],
    ["gitDiff", "git diff --check"],
    ["tempScan", "Temp-file scan"],
    ["result", "Result"],
    ["note", "Notes"],
  ];
}

function singleLineEvidenceValue(value: string | undefined): string {
  return (value ?? "").replace(/\s+/gu, " ").trim();
}

function phaseTwoEvidenceInsertionRange(text: string, section: PhaseTwoEvidenceRecordSection): { start: number; end: number } {
  const start = firstPhaseTwoMarkerIndex(text, phaseTwoSectionStartPatterns(section), 0);
  if (start === undefined) {
    throw new Error(`Could not find ${section} evidence section in Phase 2 plan.`);
  }
  const end = firstPhaseTwoMarkerIndex(text, phaseTwoSectionEndPatterns(section), start + 1) ?? text.length;
  return { start, end };
}

function phaseTwoSectionStartPatterns(section: PhaseTwoEvidenceRecordSection): RegExp[] {
  return [
    new RegExp(`^###\\s*${section}\\b.*evidence.*$`, "im"),
    new RegExp(`^- \\[[ xX]\\] \\*\\*${section}:`, "im"),
  ];
}

function phaseTwoSectionEndPatterns(section: PhaseTwoEvidenceRecordSection): RegExp[] {
  if (section === "C1") {
    return phaseTwoSectionStartPatterns("C2");
  }
  if (section === "C2") {
    return phaseTwoSectionStartPatterns("C3");
  }
  return [
    /^- \[[ xX]\] \*\*C4:/im,
    /^####\s+Must-Finish Work Snapshot\b/im,
    /^###\s+Event Stream Remaining Work\b/im,
    /^##\s+Task\b/im,
  ];
}

function firstPhaseTwoMarkerIndex(text: string, patterns: RegExp[], from: number): number | undefined {
  let best: number | undefined;
  const slice = text.slice(from);
  for (const pattern of patterns) {
    const match = pattern.exec(slice);
    if (!match) {
      continue;
    }
    const index = from + match.index;
    if (best === undefined || index < best) {
      best = index;
    }
  }
  return best;
}

function countEvidenceSecretMatches(text: string): number {
  const patterns = [
    /sk-[A-Za-z0-9_-]{12,}/g,
    /Authorization:\s*Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
    /AGENT_SECRETS_PASSPHRASE=\S{4,}/gi,
  ];
  return patterns.reduce((total, pattern) => total + (text.match(pattern)?.length ?? 0), 0);
}

function redactPhaseTwoEvidenceText(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "[REDACTED_SECRET]")
    .replace(/Authorization:\s*Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Authorization: Bearer [REDACTED_SECRET]")
    .replace(/AGENT_SECRETS_PASSPHRASE=\S{4,}/gi, "AGENT_SECRETS_PASSPHRASE=[REDACTED_SECRET]");
}

function trimPhaseTwoEvidenceReviewText(text: string): string {
  const trimmed = text.trim();
  const nextHeading = trimmed.search(/\n##\s+/u);
  return (nextHeading >= 0 ? trimmed.slice(0, nextHeading) : trimmed).trim();
}

function stripMarkdownCodeForEvidenceScan(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`\r\n]+`/g, "");
}

function extractPhaseTwoEvidenceSection(text: string, sectionId: "C1" | "C2" | "C3"): string {
  try {
    const range = phaseTwoEvidenceInsertionRange(text, sectionId);
    return text.slice(range.start, range.end);
  } catch {
    // Fall back for older standalone evidence files that predate the closure-task checklist.
  }
  const evidenceHeading = phaseTwoEvidenceHeadingPattern(sectionId);
  const fallbackHeading = new RegExp(`${sectionId}(?:\\s+external|\\s+real-provider|\\s+final|:\\s*Record|:\\s*Re-run)`, "i");
  let start = text.search(evidenceHeading);
  if (start < 0) {
    start = text.search(fallbackHeading);
  }
  if (start < 0) {
    return "";
  }
  const rest = text.slice(start);
  const next = findNextDifferentPhaseTwoSection(rest, sectionId);
  return next < 0 ? rest : rest.slice(0, next);
}

function phaseTwoEvidenceHeadingPattern(sectionId: "C1" | "C2" | "C3"): RegExp {
  if (sectionId === "C1") {
    return /(?:^|\n)(?:#{1,6}\s+)?C1\s+external terminal rich[-\s]?TUI evidence/i;
  }
  if (sectionId === "C2") {
    return /(?:^|\n)(?:#{1,6}\s+)?C2\s+real-provider setup and task evidence/i;
  }
  return /(?:^|\n)(?:#{1,6}\s+)?C3\s+final automated gate evidence/i;
}

function findNextDifferentPhaseTwoSection(text: string, sectionId: "C1" | "C2" | "C3"): number {
  const pattern = /\n(?:#{1,6}\s+)?C([123])(?:\s+external|\s+real-provider|\s+final|:\s*Record|:\s*Re-run)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (`C${match[1]}` !== sectionId) {
      return match.index;
    }
  }
  return -1;
}

function sectionHasDate(text: string): boolean {
  return /\b20\d{2}-\d{2}-\d{2}\b/.test(text) ||
    /\b20\d{2}\/\d{1,2}\/\d{1,2}\b/.test(text) ||
    /\b20\d{2}年\d{1,2}月\d{1,2}日\b/.test(text) ||
    /\bDate:[^\S\r\n]*(?:[A-Z][a-z]+ \d{1,2}, 20\d{2})\b/i.test(text);
}

type PhaseTwoClosureTaskState = "complete" | "incomplete" | "absent";

function phaseTwoClosureTaskState(text: string, sectionId: "C1" | "C2" | "C3"): PhaseTwoClosureTaskState {
  const match = text.match(new RegExp(`^\\s*- \\[(?<mark>[ xX])\\] \\*\\*${sectionId}:`, "m"));
  if (!match) {
    return "absent";
  }
  return match.groups?.mark?.toLowerCase() === "x" ? "complete" : "incomplete";
}

function closureTaskCheckStatus(state: PhaseTwoClosureTaskState): PhaseTwoReadinessCheckStatus {
  if (state === "absent") {
    return "skip";
  }
  return state === "complete" ? "pass" : "fail";
}

function closureTaskCheckSummary(sectionId: "C1" | "C2" | "C3", state: PhaseTwoClosureTaskState): string {
  if (state === "complete") {
    return `${sectionId} closure task is checked.`;
  }
  if (state === "incomplete") {
    return `${sectionId} closure task is still unchecked.`;
  }
  return `No ${sectionId} closure task checkbox was found; using dated evidence only.`;
}

export function renderPhaseTwoRealProviderReadiness(readiness: PhaseTwoRealProviderReadiness): string {
  const lines = [
    "Phase 2 real-provider readiness",
    `status=${readiness.status}`,
    `workspace=${readiness.workspace}`,
    `activeProvider=${readiness.activeProvider}`,
    `model=${readiness.model}`,
    `baseUrl=${readiness.baseUrl}`,
    "",
    "Checks:",
  ];
  for (const check of readiness.checks) {
    lines.push(`- ${check.id}: ${check.status}`);
    lines.push(`  ${check.summary}`);
  }
  lines.push(
    "",
    "Next:",
    `- Open real TTY: ${readiness.nextCommands.launchTerminal}`,
    `- Configure model if readiness reports a problem: ${readiness.nextCommands.setup}`,
    `- Check model: ${readiness.nextCommands.modelCheck}`,
    `- Task: ${readiness.nextCommands.task}`,
    `- Leak scan: ${readiness.nextCommands.leakScan}`,
    `- One-sitting closeout: ${readiness.nextCommands.closeoutWizardAll}`,
    `- Record and review evidence: ${readiness.nextCommands.closeoutWizard}`,
    `- Paste-safe evidence template: ${readiness.nextCommands.evidenceTemplate}`,
    "",
    "This readiness check does not satisfy C2; C2 still requires a real external-terminal task run and dated evidence.",
    "Never record API keys, key prefixes, bearer tokens, vault passphrases, or Authorization headers.",
  );
  return lines.join("\n");
}

function phaseTwoReadinessStatus(
  isRealProvider: boolean,
  apiKeyReady: boolean,
  secretStorageReady: boolean,
  leakMatches: number,
): PhaseTwoRealProviderReadiness["status"] {
  if (leakMatches > 0) {
    return "secret_leak_detected";
  }
  if (!isRealProvider) {
    return "missing_real_provider";
  }
  if (!apiKeyReady) {
    return "missing_api_key_reference";
  }
  if (!secretStorageReady) {
    return "missing_secret_storage";
  }
  return "ready_for_manual_run";
}

async function scanPhaseTwoSecretLeakShapes(workspace: string): Promise<{ matches: number }> {
  const agentDir = path.join(workspace, ".agent");
  const fileNames = ["model-providers.json", "secrets.vault.json", "secrets.key"];
  let matches = 0;
  for (const fileName of fileNames) {
    const filePath = path.join(agentDir, fileName);
    try {
      const text = await fs.readFile(filePath, "utf8");
      const found = text.match(/sk-[A-Za-z0-9_-]{12,}|Authorization:\s*Bearer|AGENT_SECRETS_PASSPHRASE=.+/gi);
      matches += found?.length ?? 0;
    } catch (error) {
      if (!isNodeErrorWithCode(error, "ENOENT")) {
        throw error;
      }
    }
  }
  return { matches };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}
