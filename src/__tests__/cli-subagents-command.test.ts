import assert from "node:assert/strict";
import test from "node:test";
import { createDelegateCommand, createSubtasksCommand, type DelegateCommandDeps, type SubtasksCommandDeps } from "../cli/commands/subagents.js";

function createDelegateDeps(events: string[], parsed: { task?: string; options: Record<string, unknown> }, delegateResult?: Record<string, any>): DelegateCommandDeps {
  return {
    cwd: () => "E:\\code\\agent",
    parseRunArgs: (args) => {
      events.push(`parse:${args.join(" ")}`);
      return parsed;
    },
    createPlatform: async (cwd, options) => {
      events.push(`platform:${cwd}:${JSON.stringify(options)}`);
      return {
        subagents: {
          delegate: async (input: Record<string, unknown>) => {
            events.push(`delegate:${JSON.stringify(input)}`);
            return delegateResult ?? {
              subtask: { id: "subtask_1", status: "completed" },
              childSession: { id: "session_1" },
              summary: "done",
            };
          },
        },
        store: {
          close: () => events.push("close"),
        },
      };
    },
    actor: () => ({ type: "user", id: "local-user", displayName: "Local User" }),
    writeJson: (value) => events.push(`json:${JSON.stringify(value)}`),
    writeError: (message) => events.push(`error:${message}`),
    setExitCode: (code) => events.push(`exit:${code}`),
  };
}

function createSubtasksDeps(events: string[], subtasks: Array<Record<string, unknown>>): SubtasksCommandDeps {
  return {
    cwd: () => "E:\\code\\agent",
    createPlatform: async (cwd) => {
      events.push(`platform:${cwd}`);
      return {
        store: {
          listSubtasks: async (parentSessionId?: string) => {
            events.push(`list:${parentSessionId ?? "-"}`);
            return subtasks;
          },
          close: () => events.push("close"),
        },
      };
    },
    writeText: (text) => events.push(`text:${text}`),
  };
}

test("createDelegateCommand reports missing subtask objective before opening platform", async () => {
  const events: string[] = [];
  const command = createDelegateCommand(createDelegateDeps(events, { task: undefined, options: {} }));

  const result = await command.execute({ command: "delegate", args: [], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, ["parse:", "error:Missing subtask objective.", "exit:1"]);
});

test("createDelegateCommand delegates with parsed run options and writes the legacy JSON shape", async () => {
  const events: string[] = [];
  const command = createDelegateCommand(createDelegateDeps(events, {
    task: "inspect module",
    options: {
      parentSessionId: "session_parent",
      roomId: "room_1",
      assignedAgentId: "agent_1",
      executionMode: "balanced",
    },
  }));

  const result = await command.execute({ command: "delegate", args: ["--room", "room_1", "inspect", "module"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "parse:--room room_1 inspect module",
    'platform:E:\\code\\agent:{"parentSessionId":"session_parent","roomId":"room_1","assignedAgentId":"agent_1","executionMode":"balanced"}',
    'delegate:{"objective":"inspect module","parentSessionId":"session_parent","roomId":"room_1","assignedAgentId":"agent_1","createdBy":{"type":"user","id":"local-user","displayName":"Local User"},"executionMode":"balanced"}',
    'json:{"subtaskId":"subtask_1","status":"completed","childSessionId":"session_1","summary":"done"}',
    "close",
  ]);
});

test("createDelegateCommand defaults execution mode to trusted", async () => {
  const events: string[] = [];
  const command = createDelegateCommand(createDelegateDeps(events, { task: "small task", options: {} }));

  const result = await command.execute({ command: "delegate", args: ["small", "task"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.match(events.find((event) => event.startsWith("delegate:")) ?? "", /"executionMode":"trusted"/);
});

test("createSubtasksCommand lists subtasks for the optional parent session", async () => {
  const events: string[] = [];
  const command = createSubtasksCommand(createSubtasksDeps(events, [
    {
      id: "subtask_1",
      status: "completed",
      createdAt: "2026-06-26T00:00:00.000Z",
      childSessionId: "session_child",
      parentSessionId: "session_parent",
      objective: "Inspect module",
    },
    {
      id: "subtask_2",
      status: "running",
      createdAt: "2026-06-26T00:01:00.000Z",
      objective: "Run tests",
    },
  ]));

  const result = await command.execute({ command: "subtasks", args: ["session_parent"], context: undefined });

  assert.deepEqual(result, { matched: true });
  assert.deepEqual(events, [
    "platform:E:\\code\\agent",
    "list:session_parent",
    "text:subtask_1\tcompleted\t2026-06-26T00:00:00.000Z\tchild=session_child\tparent=session_parent\tInspect module",
    "text:subtask_2\trunning\t2026-06-26T00:01:00.000Z\tchild=-\tparent=-\tRun tests",
    "close",
  ]);
});
