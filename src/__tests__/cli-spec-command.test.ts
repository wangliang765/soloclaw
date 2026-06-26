import assert from "node:assert/strict";
import test from "node:test";
import { createSpecCommand, type SpecCommandDeps } from "../cli/commands/spec.js";

function createBaseDeps(events: string[], specifications: Record<string, unknown>): SpecCommandDeps {
  return {
    createPlatform: async () => ({
      specifications,
      close: () => events.push("close"),
    }),
    actor: () => ({ type: "user", id: "local-user" }),
    parseArgs: (args) => {
      const options: Record<string, unknown> = {};
      const positionals: string[] = [];
      for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        const next = args[index + 1];
        if (arg === "--json") {
          options.json = true;
          continue;
        }
        if (arg === "--status" && next) {
          options.status = next;
          index += 1;
          continue;
        }
        if (arg === "--worker" && next) {
          options.workerId = next;
          index += 1;
          continue;
        }
        if (arg === "--auto-select-worker") {
          options.autoSelectWorker = true;
          continue;
        }
        if (arg === "--room" && next) {
          options.roomId = next;
          index += 1;
          continue;
        }
        positionals.push(arg);
      }
      return { options, positionals };
    },
    parseSpecificationStatus: (value) => `spec-status:${value}`,
    parseSpecificationPlanStatus: (value) => `plan-status:${value}`,
    parseSpecificationClarificationStatus: (value) => `clarification-status:${value}`,
    parseAnswerClarificationStatus: (value) => `answer-status:${value}`,
    parseSpecificationTaskStatus: (value) => `task-status:${value}`,
    parseSpecificationVerificationStatus: (value) => `verification-status:${value}`,
    parseSpecificationEvidenceProvider: (value) => `provider:${value}`,
    parseSpecificationEvidenceConclusion: (value) => `conclusion:${value}`,
    writeText: (text) => events.push(`text:${text}`),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  };
}

test("createSpecCommand creates specifications", async () => {
  const events: string[] = [];
  const command = createSpecCommand(createBaseDeps(events, {
    create: async (input: Record<string, unknown>) => {
      events.push(`create:${input.objective}`);
      return { id: "spec_1", status: "draft", projectId: undefined, title: "Generated title" };
    },
  }));

  const result = await command.execute({ command: "spec", args: ["create", "Build", "thing"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ["create:Build thing", "text:spec_1\tdraft\t-\tGenerated title", "close"]);
});

test("createSpecCommand lists specifications with parsed status filter", async () => {
  const events: string[] = [];
  const command = createSpecCommand(createBaseDeps(events, {
    list: async (input: Record<string, unknown>) => {
      events.push(`list:${input.status}`);
      return [{ id: "spec_1", status: "ready", updatedAt: "2026-06-26T00:00:00.000Z", projectId: "proj_1", roomId: undefined, title: "Spec" }];
    },
  }));

  const result = await command.execute({ command: "spec", args: ["list", "--status", "ready"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "list:spec-status:ready",
    "text:spec_1\tready\t2026-06-26T00:00:00.000Z\tproject=proj_1\troom=-\tSpec",
    "close",
  ]);
});

test("createSpecCommand reports missing show specs", async () => {
  const events: string[] = [];
  const command = createSpecCommand(createBaseDeps(events, {
    get: async () => undefined,
  }));

  const result = await command.execute({ command: "spec", args: ["show", "spec_missing"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ["error:Specification not found: spec_missing", "exit:1", "close"]);
});

test("createSpecCommand writes show json bundle", async () => {
  const events: string[] = [];
  const command = createSpecCommand(createBaseDeps(events, {
    get: async () => ({ id: "spec_1" }),
    listTasks: async () => [{ id: "task_1" }],
    listTaskVerifications: async () => [],
    listVersions: async () => [],
    listClarifications: async () => [],
    listPlans: async () => [],
  }));

  const result = await command.execute({ command: "spec", args: ["show", "spec_1"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ['json:{"spec":{"id":"spec_1"},"tasks":[{"id":"task_1"}],"verifications":[],"versions":[],"clarifications":[],"plans":[]}', "close"]);
});

test("createSpecCommand validates DAGs and sets exit on invalid result", async () => {
  const events: string[] = [];
  const command = createSpecCommand(createBaseDeps(events, {
    validateDag: async () => ({
      specId: "spec_1",
      valid: false,
      taskCount: 2,
      issues: [{ type: "cycle", taskId: "task_1", dependencyId: "task_2", message: "Cycle" }],
    }),
  }));

  const result = await command.execute({ command: "spec", args: ["validate", "spec_1"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "text:spec_1\tvalid=false\ttasks=2\tissues=1",
    "text:cycle\ttask_1\ttask_2\tCycle",
    "exit:1",
    "close",
  ]);
});

test("createSpecCommand delegates tasks as json", async () => {
  const events: string[] = [];
  const command = createSpecCommand(createBaseDeps(events, {
    delegateTask: async (input: Record<string, unknown>) => {
      events.push(`delegate:${input.specId}:${input.taskId}:${input.roomId}`);
      return {
        specification: { id: "spec_1" },
        task: { id: "task_1", status: "in_progress" },
        subtask: { id: "subtask_1", childSessionId: "session_1" },
      };
    },
  }));

  const result = await command.execute({ command: "spec", args: ["delegate", "spec_1", "task_1", "--room", "room_1"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "delegate:spec_1:task_1:room_1",
    'json:{"specId":"spec_1","taskId":"task_1","taskStatus":"in_progress","subtaskId":"subtask_1","childSessionId":"session_1","next":"agent assignments assign-subtask subtask_1 --worker <worker-id>"}',
    "close",
  ]);
});

test("createSpecCommand reports dispatch usage without worker target", async () => {
  const events: string[] = [];
  const command = createSpecCommand(createBaseDeps(events, {}));

  const result = await command.execute({ command: "spec", args: ["dispatch", "spec_1"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ["error:Usage: agent spec dispatch <spec-id> (--worker worker-id|--auto-select-worker) [--plan plan-id] [--require-plan-approval] [--required-plan-approvals n] [--limit n] [--max-load-ratio n] [--max-queued-per-worker n] [--ttl seconds] [--priority n] [--room room-id] [--assigned-agent agent-id]", "exit:1", "close"]);
});
