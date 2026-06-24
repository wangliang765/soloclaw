import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { ModelProviderName } from "../../model/model-client.js";
import { createLocalPlatform } from "../../platform/local-platform.js";
import { buildPhaseTwoRealProviderReadiness } from "../phase2-closure-status.js";
import { ansi, stripAnsi } from "./ansi.js";
import { startRichTuiShellWithTerminal, type RichTuiInputStream, type RichTuiKey, type RichTuiOutputStream } from "./rich-shell.js";
import type { RichTuiMode } from "./state.js";

export type RichTuiSmokeResult = {
  ok: boolean;
  workspace: string;
  provider: ModelProviderName;
  model: string;
  saw: string[];
  answer: string;
  context: string;
  frame: string;
};

export type RichTuiRealProviderSmokeResult = RichTuiSmokeResult & {
  readinessStatus: string;
  task: string;
  sessionId?: string;
  longTask?: boolean;
  eventCount?: number;
  toolEventCount?: number;
};

const REAL_PROVIDER_SMOKE_TASK = "Inspect package.json and report only the npm scripts whose names include test or check. Do not modify files.";
const REAL_PROVIDER_LONG_TASK = [
  "Perform a read-only multi-step verification of this Soloclaw workspace.",
  "Before answering, inspect package.json, tsconfig.json, src/cli/tui/layout.ts, src/cli/tui/rich-shell.ts, and docs/superpowers/plans/2026-06-18-soloclaw-rich-tui-event-stream.md.",
  "Report: 1) the command that opens the TUI, 2) the chat-first UI surfaces, 3) the test/check commands that verify the TUI, and 4) whether any file modifications are needed.",
  "Do not modify files.",
].join(" ");

export async function runRichTuiSmoke(input: {
  workspace: string;
  provider?: ModelProviderName;
  model?: string;
  readiness?: string;
  version?: string;
}): Promise<RichTuiSmokeResult> {
  const provider = input.provider ?? "mock";
  const model = input.model ?? "mock";
  const terminalInput = new SmokeInput();
  const terminalOutput = new SmokeOutput(140, 32);
  const answer = "rich-smoke-done";
  const resumeAnswer = "resume-rich-smoke-done";
  const run = startRichTuiShellWithTerminal({
    workspace: input.workspace,
    provider,
    model,
    readiness: input.readiness ?? "pass",
    version: input.version ?? "smoke",
    runTask: async ({ onEvent }) => {
      await onEvent({
        type: "tool_started",
        runId: "run_rich_smoke",
        step: 1,
        callId: "call_read",
        toolName: "read_file",
        title: "Read README.md",
        detailsHidden: true,
      });
      await onEvent({ type: "assistant_text", runId: "run_rich_smoke", step: 1, text: answer, final: true });
      return {
        answer,
        sessionId: "sess_rich_smoke",
        context: { tokens: 1200, percentUsed: 3 },
        durationMs: 25,
      };
    },
    resumeSession: async ({ sessionId, onEvent }) => {
      await onEvent({
        type: "tool_started",
        runId: "run_rich_smoke_resume",
        step: 1,
        callId: "call_resume_read",
        toolName: "read_file",
        title: `Resume ${sessionId}`,
        detailsHidden: true,
      });
      await onEvent({ type: "assistant_text", runId: "run_rich_smoke_resume", step: 1, text: resumeAnswer, final: true });
      return {
        answer: resumeAnswer,
        sessionId,
        context: { tokens: 1200, percentUsed: 3 },
        durationMs: 15,
      };
    },
  }, {
    input: terminalInput,
    output: terminalOutput,
    emitKeypressEvents: () => undefined,
  });

  await tick();
  const saw = new Set<string>();
  if (isChatFirstWelcomeFrame(terminalOutput.latestPlainFrame())) {
    saw.add("welcome");
  }
  terminalInput.emitKey("", { name: "f2" });
  await waitFor(
    () => terminalOutput.latestPlainFrame().includes("Goal"),
    "mode switch",
    () => terminalOutput.latestPlainFrame(),
  );
  if (terminalOutput.latestPlainFrame().includes("Goal")) {
    saw.add("mode");
  }
  await typeSmokeText(terminalInput, "Inspect workspace");
  await waitFor(
    () => terminalOutput.latestPlainFrame().includes("Inspect workspace"),
    "initial input",
    () => terminalOutput.latestPlainFrame(),
  );
  saw.add("input");
  terminalInput.emitKey("\r", { name: "return" });
  await waitFor(() => terminalOutput.plainText().includes(answer), "initial answer");
  const plain = terminalOutput.plainText();
  if (plain.includes("Read README.md")) {
    saw.add("progress");
  }
  if (plain.includes(answer)) {
    saw.add("answer");
  }
  if (plain.includes("1.2K (3%)")) {
    saw.add("context");
  }
  await typeSmokeText(terminalInput, "/resume");
  terminalInput.emitKey("\r", { name: "return" });
  await waitFor(() => terminalOutput.plainText().includes(resumeAnswer), "resume answer");
  await waitFor(() => terminalOutput.latestPlainFrame().includes("Run: Done"), "resume completion");
  await tick(50);
  if (terminalOutput.plainText().includes("Resuming session sess_rich_smoke") && terminalOutput.plainText().includes(resumeAnswer)) {
    saw.add("resume");
  }
  await waitFor(() => terminalOutput.latestPlainFrame().includes("Ask Soloclaw"), "prompt after resume");
  await typeSmokeText(terminalInput, "/phase2 status");
  await waitFor(
    () => terminalOutput.latestPlainFrame().includes("/phase2 status"),
    "phase2 status input",
    () => terminalOutput.latestPlainFrame(),
  );
  await tick(250);
  terminalInput.emitKey("\r", { name: "return" });
  await waitFor(
    () => terminalOutput.plainText().includes("status=pending_manual_evidence"),
    "phase2 status",
    () => terminalOutput.latestPlainFrame(),
  );
  const phaseTwoPlain = terminalOutput.plainText();
  if (phaseTwoPlain.includes("Phase 2 closure status") && phaseTwoPlain.includes("status=pending_manual_evidence")) {
    saw.add("phase2");
  }
  await typeSmokeText(terminalInput, "/clear");
  terminalInput.emitKey("\r", { name: "return" });
  await waitFor(() => terminalOutput.latestPlainFrame().includes("Ask Soloclaw"), "clear before evidence-record");
  const evidenceFile = path.join(input.workspace, ".agent", "tmp", "rich-tui-smoke-evidence.md");
  await fs.mkdir(path.dirname(evidenceFile), { recursive: true });
  await fs.writeFile(evidenceFile, [
    "### C1 external terminal rich-TUI evidence",
    "",
    "### C2 real-provider setup and task evidence",
    "",
    "### C3 final automated gate evidence",
    "",
  ].join("\n"), "utf8");
  await typeSmokeText(terminalInput, [
    "/phase2 evidence-record",
    "--section C1",
    `--file ${quoteRichSmokeCommandArg(evidenceFile)}`,
    "--terminal \"Injected TTY\"",
    "--shell \"scripted smoke\"",
    "--node scripted",
    "--result \"Rich smoke evidence-record worked\"",
  ].join(" "));
  terminalInput.emitKey("\r", { name: "return" });
  await waitFor(
    () => terminalOutput.plainText().includes("Phase 2 evidence recorded"),
    "phase2 evidence-record",
    () => terminalOutput.latestPlainFrame(),
  );
  const evidenceRecordPlain = terminalOutput.plainText();
  if (evidenceRecordPlain.includes("Phase 2 evidence recorded") && evidenceRecordPlain.includes("secretMatches=0")) {
    saw.add("evidence-record");
  }
  await fs.rm(evidenceFile, { force: true });
  await typeSmokeText(terminalInput, "/clear");
  terminalInput.emitKey("\r", { name: "return" });
  await waitFor(() => terminalOutput.latestPlainFrame().includes("Ask Soloclaw"), "clear transcript");
  await typeSmokeText(terminalInput, "/phase2 evidence-check");
  terminalInput.emitKey("\r", { name: "return" });
  await waitFor(() => terminalOutput.plainText().includes("Phase 2 evidence check"), "phase2 evidence-check");
  const evidenceCheckPlain = terminalOutput.plainText();
  if (evidenceCheckPlain.includes("Phase 2 evidence check") && evidenceCheckPlain.includes("secretMatches=0")) {
    saw.add("evidence-check");
  }
  terminalInput.emitKey("", { ctrl: true, name: "c" });
  await run;
  if (terminalInput.rawModes.at(-1) === false && terminalOutput.text.includes(ansi.showCursor)) {
    saw.add("exit");
  }

  const orderedSaw = ["welcome", "mode", "input", "progress", "answer", "context", "resume", "phase2", "evidence-record", "evidence-check", "exit"].filter((item) => saw.has(item));
  return {
    ok: orderedSaw.length === 11,
    workspace: input.workspace,
    provider,
    model,
    saw: orderedSaw,
    answer,
    context: "1.2K (3%)",
    frame: terminalOutput.latestPlainFrame(),
  };
}

export async function runRichTuiRealProviderSmoke(input: {
  workspace: string;
  task?: string;
  version?: string;
  longTask?: boolean;
}): Promise<RichTuiRealProviderSmokeResult> {
  const readiness = await buildPhaseTwoRealProviderReadiness(input.workspace);
  if (readiness.status !== "ready_for_manual_run" || readiness.activeProvider === "mock") {
    const label = input.longTask ? "Real-provider long-task rich TUI smoke" : "Real-provider rich TUI smoke";
    throw new Error(
      `${label} is not ready: status=${readiness.status}. Run soloclaw phase2 readiness, then configure a real provider with /model setup.`,
    );
  }
  const provider = readiness.activeProvider as ModelProviderName;
  const model = readiness.model;
  const task = input.task ?? (input.longTask ? REAL_PROVIDER_LONG_TASK : REAL_PROVIDER_SMOKE_TASK);
  const terminalInput = new SmokeInput();
  const terminalOutput = new SmokeOutput(140, 32);
  let answer = "";
  let sessionId: string | undefined;
  let eventCount = 0;
  let toolEventCount = 0;

  const run = startRichTuiShellWithTerminal({
    workspace: input.workspace,
    provider,
    model,
    readiness: readiness.status,
    version: input.version ?? "smoke",
    runTask: async ({ task: submittedTask, mode, onEvent }) => {
      const startedAt = Date.now();
      const platform = await createLocalPlatform(input.workspace, {
        provider,
        knowledgeQuery: submittedTask,
        targetMode: richTuiModeToTargetMode(mode),
        maxSteps: 80,
        onAgentProgress: async (event) => {
          eventCount += 1;
          if (event.type === "tool_started" || event.type === "tool_finished") {
            toolEventCount += 1;
          }
          await onEvent(event);
        },
      });
      try {
        const result = await platform.agent.runWithSession(submittedTask);
        answer = result.finalAnswer;
        sessionId = result.session?.id;
        return {
          answer,
          sessionId,
          durationMs: Date.now() - startedAt,
        };
      } finally {
        platform.locks.close?.();
        platform.store.close();
      }
    },
  }, {
    input: terminalInput,
    output: terminalOutput,
    emitKeypressEvents: () => undefined,
  });

  await tick();
  const saw = new Set<string>();
  if (isChatFirstWelcomeFrame(terminalOutput.latestPlainFrame())) {
    saw.add("welcome");
  }
  for (const char of "/phase2 readiness") {
    terminalInput.emitKey(char, { name: char });
  }
  terminalInput.emitKey("\r", { name: "return" });
  await waitFor(
    () => terminalOutput.plainText().includes("status=ready_for_manual_run"),
    "real-provider readiness",
    () => terminalOutput.latestPlainFrame(),
  );
  if (terminalOutput.plainText().includes("Phase 2 real-provider readiness")) {
    saw.add("readiness");
  }
  for (const char of task) {
    terminalInput.emitKey(char, { name: char });
  }
  await waitFor(
    () => terminalOutput.latestPlainFrame().includes(inputProbe(task)),
    "real-provider task input",
    () => terminalOutput.latestPlainFrame(),
  );
  saw.add("input");
  terminalInput.emitKey("\r", { name: "return" });
  await waitFor(() => answer.length > 0, "real-provider answer");
  await tick(25);
  const postRunPlain = terminalOutput.plainText();
  if (postRunPlain.includes("Thinking") || postRunPlain.includes("Model") || postRunPlain.includes("Step")) {
    saw.add("progress");
  }
  if (containsAnswerProbe(postRunPlain, answer)) {
    saw.add("answer");
  }
  terminalInput.emitKey("", { ctrl: true, name: "c" });
  await run;
  if (terminalInput.rawModes.at(-1) === false && terminalOutput.text.includes(ansi.showCursor)) {
    saw.add("exit");
  }

  const orderedSaw = ["welcome", "readiness", "input", "progress", "answer", "exit"].filter((item) => saw.has(item));
  const ok = orderedSaw.length === 6 && (!input.longTask || toolEventCount >= 2);
  return {
    ok,
    workspace: input.workspace,
    provider,
    model,
    saw: orderedSaw,
    answer,
    context: "n/a",
    frame: terminalOutput.latestPlainFrame(),
    readinessStatus: readiness.status,
    task,
    sessionId,
    longTask: input.longTask,
    eventCount,
    toolEventCount,
  };
}

export function formatRichTuiSmokeResult(result: RichTuiSmokeResult): string {
  return [
    "Soloclaw rich TUI smoke",
    `ok=${result.ok}`,
    `workspace=${result.workspace}`,
    `provider=${result.provider}`,
    `model=${result.model}`,
    `saw=${result.saw.join(",") || "-"}`,
    `answer=${result.answer}`,
    `context=${result.context}`,
  ].join("\n");
}

export function formatRichTuiRealProviderSmokeResult(result: RichTuiRealProviderSmokeResult): string {
  return [
    result.longTask ? "Soloclaw real-provider long-task rich TUI smoke" : "Soloclaw real-provider rich TUI smoke",
    `ok=${result.ok}`,
    `workspace=${result.workspace}`,
    `provider=${result.provider}`,
    `model=${result.model}`,
    `readiness=${result.readinessStatus}`,
    `saw=${result.saw.join(",") || "-"}`,
    `session=${result.sessionId ?? "-"}`,
    result.eventCount !== undefined ? `events=${result.eventCount}` : undefined,
    result.toolEventCount !== undefined ? `toolEvents=${result.toolEventCount}` : undefined,
    `task=${redactSmokeText(result.task)}`,
    `answerPreview=${answerPreview(result.answer, 240)}`,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

class SmokeInput extends EventEmitter implements RichTuiInputStream {
  isRaw = false;
  readonly rawModes: boolean[] = [];

  setRawMode(mode: boolean): this {
    this.isRaw = mode;
    this.rawModes.push(mode);
    return this;
  }

  resume(): this {
    return this;
  }

  emitKey(value: string, key: RichTuiKey): void {
    this.emit("keypress", value, key);
  }
}

class SmokeOutput extends EventEmitter implements RichTuiOutputStream {
  text = "";

  constructor(readonly columns: number, readonly rows: number) {
    super();
  }

  write(value: string): boolean {
    this.text += value;
    return true;
  }

  plainText(): string {
    return stripAnsi(this.text);
  }

  latestPlainFrame(): string {
    const afterFullClear = this.text.split(ansi.clear).at(-1) ?? this.text;
    return stripAnsi(afterFullClear.split(ansi.home).at(-1) ?? afterFullClear);
  }
}

async function waitFor(predicate: () => boolean, label = "condition", debugText?: () => string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (predicate()) {
      return;
    }
    await tick(25);
  }
  const debug = debugText?.();
  throw new Error(`Rich TUI smoke timed out: ${label}.${debug ? `\n${redactSmokeText(debug).slice(0, 4000)}` : ""}`);
}

async function typeSmokeText(input: SmokeInput, text: string): Promise<void> {
  for (const char of text) {
    input.emitKey(char, { name: char });
    await tick(2);
  }
}

function tick(delayMs = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function quoteRichSmokeCommandArg(value: string): string {
  return `"${value.replace(/"/g, "")}"`;
}

function richTuiModeToTargetMode(mode: RichTuiMode): "plan" | "build" | "goal" {
  return mode.toLowerCase() as "plan" | "build" | "goal";
}

function answerPreview(text: string, limit: number): string {
  const redacted = redactSmokeText(text).replace(/\s+/g, " ").trim();
  return redacted.length > limit ? `${redacted.slice(0, limit)}...` : redacted;
}

function redactSmokeText(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[REDACTED_API_KEY]")
    .replace(/Authorization:\s*Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Authorization: Bearer [REDACTED]")
    .replace(/AGENT_SECRETS_PASSPHRASE=.+/gi, "AGENT_SECRETS_PASSPHRASE=[REDACTED]");
}

function inputProbe(text: string): string {
  return text.split(/\s+/).slice(0, 3).join(" ");
}

function isChatFirstWelcomeFrame(frame: string): boolean {
  return (
    /Soloclaw/i.test(frame) &&
    frame.includes("Ask Soloclaw") &&
    frame.includes("Plan") &&
    frame.includes("Model") &&
    frame.includes("Run") &&
    frame.includes("Workspace") &&
    !/MISSION|LEDGER|CHECKS|INPUT DOCK/.test(frame)
  );
}

function containsAnswerProbe(renderedText: string, answer: string): boolean {
  const probes = answer.match(/[A-Za-z0-9_.-]{4,}/g) ?? [];
  return probes.slice(0, 12).some((probe) => renderedText.includes(probe));
}
