import assert from "node:assert/strict";
import test from "node:test";
import { evaluateCompletionGate } from "../core/completion-gate.js";

test("completion gate warns when files changed without verification command", () => {
  const result = evaluateCompletionGate({
    targetMode: "build",
    changedFiles: ["src/example.ts"],
    commandEvents: [],
    pendingApprovalCount: 0,
    failedToolCount: 0,
  });

  assert.equal(result.status, "warn");
  assert.deepEqual(result.missingEvidence, ["verification_command"]);
});

test("completion gate passes when change and verification evidence exist", () => {
  const result = evaluateCompletionGate({
    targetMode: "build",
    changedFiles: ["src/example.ts"],
    commandEvents: [{ command: "npm.cmd run build", exitCode: 0 }],
    pendingApprovalCount: 0,
    failedToolCount: 0,
  });

  assert.equal(result.status, "pass");
  assert.deepEqual(result.missingEvidence, []);
});

test("completion gate blocks pending approvals", () => {
  const result = evaluateCompletionGate({
    targetMode: "goal",
    changedFiles: [],
    commandEvents: [],
    pendingApprovalCount: 1,
    failedToolCount: 0,
  });

  assert.equal(result.status, "block");
  assert.deepEqual(result.missingEvidence, ["pending_approvals"]);
});
